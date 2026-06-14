import re
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from src.api_payloads import build_live_payload, build_metrics_payload
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
    normalize_target,
    save_config,
)
from src.metrics import (
    VerdictStabilizer,
    clamp_window_minutes,
    compute_window_options,
)
from src.metrics_cache import MetricsCache
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
metrics_cache = MetricsCache()


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
        return normalize_target(value)


def maybe_unchanged(latest_ts: str | None, known_ts: str | None) -> dict | None:
    if known_ts is not None and known_ts == latest_ts:
        return {"unchanged": True, "latest_ts": latest_ts}
    return None


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
    unchanged = maybe_unchanged(latest_ts, knownTs)
    if unchanged is not None:
        return unchanged
    return metrics_cache.get(
        "live",
        0,
        latest_ts,
        lambda: build_live_payload(monitor, stabilizer),
    )


@app.get("/api/metrics")
def api_metrics(
    windowMinutes: int = Query(default=config.default_window_minutes),
    knownTs: str | None = Query(default=None),
):
    window = clamp_window_minutes(windowMinutes)
    latest = monitor.get_latest_sample()
    latest_ts = latest["ts"] if latest else None
    unchanged = maybe_unchanged(latest_ts, knownTs)
    if unchanged is not None:
        return unchanged
    return metrics_cache.get(
        "full",
        window,
        latest_ts,
        lambda: build_metrics_payload(monitor, stabilizer, window),
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
