from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.config import PROJECT_ROOT, load_config
from src.metrics import (
    BLOCKS_BUCKET_SECONDS,
    NOW_WINDOW_SECONDS,
    TREND_PRIOR_SECONDS,
    TREND_RECENT_SECONDS,
    VerdictStabilizer,
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
)
from src.network_info import get_active_connection
from src.ping_monitor import PingMonitor

STATIC_DIR = PROJECT_ROOT / "static"

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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    monitor.start()
    yield
    monitor.stop()


app = FastAPI(title="Network Monitor", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
async def api_config():
    return {
        "target": config.target,
        "default_window_minutes": config.default_window_minutes,
        "ping_interval_seconds": config.ping_interval_seconds,
        "max_log_age_minutes": config.max_log_age_minutes,
        "window_options": compute_window_options(config.max_log_age_minutes),
    }


@app.get("/api/connection")
def api_connection():
    return get_active_connection()


@app.get("/api/metrics/status")
async def api_metrics_status():
    latest = monitor.get_latest_sample()
    return {
        "latest_ts": latest["ts"] if latest else None,
    }


@app.get("/api/metrics")
async def api_metrics(windowMinutes: int = Query(default=config.default_window_minutes)):
    window = clamp_window_minutes(windowMinutes)
    samples = monitor.get_samples(window)
    stats = compute_stats(samples)
    chart_samples = downsample_samples(samples, window_minutes=window)

    now_window_minutes = max(1, -(-NOW_WINDOW_SECONDS // 60))
    now_samples = monitor.get_samples(now_window_minutes)
    now_stats = compute_now_stats(now_samples)
    flow = compute_baseline_and_spikes(now_samples)
    instant = compute_instant_verdict(now_stats, flow)
    display = stabilizer.update(instant["level"])

    trend_minutes = max(1, -(-(TREND_RECENT_SECONDS + TREND_PRIOR_SECONDS) // 60))
    trend = compute_trend(monitor.get_samples(trend_minutes))
    narrative = build_status_narrative(
        now_stats=now_stats,
        flow=flow,
        verdict=instant,
        display=display,
        trend=trend,
    )

    return {
        "window_minutes": window,
        "latest_ts": samples[-1]["ts"] if samples else None,
        "samples": chart_samples,
        "recent_samples": samples[-60:],
        "sample_count_raw": len(samples),
        "stats": stats,
        "health": compute_health(stats),
        "now": {
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
        },
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


def main() -> None:
    import uvicorn

    uvicorn.run(
        "src.server:app",
        host=config.server_host,
        port=config.server_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
