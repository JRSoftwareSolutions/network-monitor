import re
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import uvicorn
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from src.config import (
    BUNDLE_ROOT,
    MAX_LOG_AGE_MINUTES,
    MAX_PING_INTERVAL_SECONDS,
    MAX_REFRESH_SECONDS,
    MIN_LOG_AGE_MINUTES,
    MIN_PING_INTERVAL_SECONDS,
    MIN_REFRESH_SECONDS,
    clamp_log_age_minutes,
    clamp_ping_interval_seconds,
    clamp_refresh_seconds,
    load_config,
    save_config,
)
from src.metrics import (
    BLOCKS_BUCKET_SECONDS,
    NOW_WINDOW_SECONDS,
    TREND_PRIOR_SECONDS,
    TREND_RECENT_SECONDS,
    VerdictStabilizer,
    parse_ts,
    bucket_samples,
    build_status_narrative,
    clamp_window_minutes,
    compute_baseline_and_spikes,
    compute_health,
    compute_instant_verdict,
    compute_now_stats,
    compute_stats,
    compute_trend,
    compute_window_options,
    detect_outages,
    downsample_samples,
    sort_samples_by_ts,
)
from src.network_info import get_active_connection
from src.ping_monitor import PingMonitor

STATIC_DIR = BUNDLE_ROOT / "static"

config = load_config()
monitor = PingMonitor(
    target=config.target,
    interval_seconds=config.ping_interval_seconds,
    log_file=config.log_file,
    max_log_age_minutes=config.max_log_age_minutes,
    archive_enabled=config.archive_enabled,
    max_log_size_bytes=config.max_log_size_bytes,
    archive_dir=config.archive_dir,
)
stabilizer = VerdictStabilizer()


class MetricsCache:
    """Reuse computed API payloads until a new ping sample arrives."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[tuple[str, int], tuple[str | None, dict]] = {}

    def get(self, kind: str, window: int, latest_ts: str | None, builder) -> dict:
        key = (kind, window)
        if kind == "live":
            with self._lock:
                cached = self._entries.get(key)
                if cached and cached[0] == latest_ts:
                    return cached[1]

        payload = builder()
        if kind == "live":
            with self._lock:
                # `window` is user-controlled (1-1440); evict entries built for an
                # older sample so the cache stays bounded to the current payloads.
                stale_keys = [k for k, (ts, _) in self._entries.items() if ts != latest_ts]
                for stale_key in stale_keys:
                    del self._entries[stale_key]
                self._entries[key] = (latest_ts, payload)
        return payload


metrics_cache = MetricsCache()

# Hostname or IPv4/IPv6 address; must not start with "-" so the value can
# never be mistaken for a ping flag by the subprocess fallback.
_TARGET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:\-]{0,252}$")


class SettingsUpdate(BaseModel):
    target: str | None = None
    ping_interval_seconds: float | None = Field(
        default=None, ge=MIN_PING_INTERVAL_SECONDS, le=MAX_PING_INTERVAL_SECONDS
    )
    full_refresh_seconds: float | None = Field(
        default=None, ge=MIN_REFRESH_SECONDS, le=MAX_REFRESH_SECONDS
    )
    connection_refresh_seconds: float | None = Field(
        default=None, ge=MIN_REFRESH_SECONDS, le=MAX_REFRESH_SECONDS
    )
    max_log_age_minutes: int | None = Field(
        default=None, ge=MIN_LOG_AGE_MINUTES, le=MAX_LOG_AGE_MINUTES
    )

    @field_validator("target")
    @classmethod
    def _validate_target(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not _TARGET_RE.match(value):
            raise ValueError("must be a hostname or IP address")
        return value


def _trend_window_minutes() -> int:
    return max(1, -(-(TREND_RECENT_SECONDS + TREND_PRIOR_SECONDS) // 60))


def _now_window_minutes() -> int:
    return max(1, -(-NOW_WINDOW_SECONDS // 60))


def _filter_samples(samples: list[dict], window_minutes: int) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    return [sample for sample in samples if parse_ts(sample["ts"]) >= cutoff]


def _build_now_payload(trend_samples: list[dict]) -> dict:
    now_samples = _filter_samples(trend_samples, _now_window_minutes())
    now_stats = compute_now_stats(now_samples)
    flow = compute_baseline_and_spikes(now_samples)
    instant = compute_instant_verdict(now_stats, flow)
    display = stabilizer.update(instant["level"])
    trend = compute_trend(trend_samples)
    narrative = build_status_narrative(
        now_stats=now_stats,
        flow=flow,
        verdict=instant,
        display=display,
        trend=trend,
    )

    return {
        "window_seconds": NOW_WINDOW_SECONDS,
        "stats": now_stats,
        "baseline_ms": flow["baseline_ms"],
        "spike_threshold_ms": flow["spike_threshold_ms"],
        "spike_count": flow["spike_count"],
        "spike_rate_per_min": flow["spike_rate_per_min"],
        "worst_spike": flow["worst_spike"],
        "ratings": instant["ratings"],
        "indicators": instant["indicators"],
        "instant_verdict": {
            "level": instant["level"],
            "label": instant["label"],
            "reasons": instant["reasons"],
        },
        "display_verdict": display,
        "trend": trend,
        "narrative": narrative,
    }


def _build_live_payload() -> dict:
    trend_samples = monitor.get_samples(_trend_window_minutes())
    latest = monitor.get_latest_sample()
    return {
        "latest_ts": latest["ts"] if latest else None,
        "recent_samples": monitor.get_recent_samples(60),
        "now": _build_now_payload(trend_samples),
    }


def _build_metrics_payload(window: int) -> dict:
    trend_minutes = _trend_window_minutes()
    fetch_minutes = max(window, trend_minutes)
    all_samples = monitor.get_samples(fetch_minutes)
    samples = sort_samples_by_ts(
        _filter_samples(all_samples, window) if fetch_minutes != window else all_samples
    )
    trend_samples = sort_samples_by_ts(_filter_samples(all_samples, trend_minutes))

    stats = compute_stats(samples)
    chart_samples = downsample_samples(samples, window_minutes=window)

    return {
        "window_minutes": window,
        "latest_ts": samples[-1]["ts"] if samples else None,
        "samples": chart_samples,
        "recent_samples": monitor.get_recent_samples(60),
        "sample_count_raw": len(samples),
        "stats": stats,
        "health": compute_health(stats),
        "now": _build_now_payload(trend_samples),
        "outages": detect_outages(samples),
        "blocks": {
            "window_minutes": window,
            "bucket_seconds": BLOCKS_BUCKET_SECONDS,
            "buckets": bucket_samples(
                samples,
                BLOCKS_BUCKET_SECONDS,
                window_minutes=window,
            ),
        },
    }


@asynccontextmanager
async def lifespan(_app: FastAPI):
    monitor.start()
    yield
    monitor.stop()


app = FastAPI(title="Network Monitor", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _render_index_html() -> str:
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/")
async def index():
    return HTMLResponse(_render_index_html(), media_type="text/html; charset=utf-8")


def _config_payload() -> dict:
    return {
        "target": config.target,
        "default_window_minutes": config.default_window_minutes,
        "ping_interval_seconds": config.ping_interval_seconds,
        "max_log_age_minutes": config.max_log_age_minutes,
        "window_options": compute_window_options(config.max_log_age_minutes),
        "full_refresh_seconds": config.full_refresh_seconds,
        "connection_refresh_seconds": config.connection_refresh_seconds,
    }


@app.get("/api/config")
async def api_config():
    return _config_payload()


@app.post("/api/config")
async def api_update_config(update: SettingsUpdate):
    if update.target is not None:
        config.target = update.target
    if update.ping_interval_seconds is not None:
        config.ping_interval_seconds = clamp_ping_interval_seconds(update.ping_interval_seconds)
    if update.full_refresh_seconds is not None:
        config.full_refresh_seconds = clamp_refresh_seconds(update.full_refresh_seconds)
    if update.connection_refresh_seconds is not None:
        config.connection_refresh_seconds = clamp_refresh_seconds(
            update.connection_refresh_seconds
        )
    if update.max_log_age_minutes is not None:
        config.max_log_age_minutes = clamp_log_age_minutes(update.max_log_age_minutes)

    save_config(config)
    monitor.apply_settings(
        target=config.target,
        interval_seconds=config.ping_interval_seconds,
        max_log_age_minutes=config.max_log_age_minutes,
    )
    return _config_payload()


@app.get("/api/connection")
def api_connection():
    return get_active_connection()


@app.get("/api/metrics/live")
def api_metrics_live(knownTs: str | None = Query(default=None)):
    latest = monitor.get_latest_sample()
    latest_ts = latest["ts"] if latest else None
    if knownTs is not None and knownTs == latest_ts:
        return {"unchanged": True, "latest_ts": latest_ts}
    return metrics_cache.get(
        "live",
        0,
        latest_ts,
        _build_live_payload,
    )


@app.get("/api/metrics")
def api_metrics(
    windowMinutes: int = Query(default=config.default_window_minutes),
    knownTs: str | None = Query(default=None),
):
    window = clamp_window_minutes(windowMinutes)
    latest = monitor.get_latest_sample()
    latest_ts = latest["ts"] if latest else None
    if knownTs is not None and knownTs == latest_ts:
        return {"unchanged": True, "latest_ts": latest_ts}
    return metrics_cache.get(
        "full",
        window,
        latest_ts,
        lambda: _build_metrics_payload(window),
    )


def create_server(host: str, port: int) -> uvicorn.Server:
    """Build a uvicorn server that can be stopped by setting `should_exit`."""
    uv_config = uvicorn.Config(
        app,
        host=host,
        port=port,
        access_log=False,
        log_level="warning",
    )
    return uvicorn.Server(uv_config)


def main() -> None:
    create_server(config.server_host, config.server_port).run()


if __name__ == "__main__":
    main()
