from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.config import PROJECT_ROOT, load_config
from src.metrics import (
    BLOCKS_BUCKET_SECONDS,
    BLOCKS_WINDOW_MINUTES,
    bucket_samples,
    clamp_window_minutes,
    compute_health,
    compute_stats,
    read_latest_sample,
    read_samples,
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
    }


@app.get("/api/connection")
async def api_connection():
    return get_active_connection()


@app.get("/api/metrics/status")
async def api_metrics_status():
    latest = read_latest_sample(config.log_file)
    return {
        "latest_ts": latest["ts"] if latest else None,
    }


@app.get("/api/metrics")
async def api_metrics(windowMinutes: int = Query(default=config.default_window_minutes)):
    window = clamp_window_minutes(windowMinutes)
    samples = read_samples(config.log_file, window)
    blocks_samples = read_samples(config.log_file, BLOCKS_WINDOW_MINUTES)
    stats = compute_stats(samples)
    return {
        "window_minutes": window,
        "latest_ts": samples[-1]["ts"] if samples else None,
        "samples": samples,
        "stats": stats,
        "health": compute_health(stats),
        "blocks": {
            "window_minutes": BLOCKS_WINDOW_MINUTES,
            "bucket_seconds": BLOCKS_BUCKET_SECONDS,
            "buckets": bucket_samples(
                blocks_samples,
                BLOCKS_BUCKET_SECONDS,
                window_minutes=BLOCKS_WINDOW_MINUTES,
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
