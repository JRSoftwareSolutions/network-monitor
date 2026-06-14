from datetime import datetime, timedelta, timezone


def ts_at(base: datetime, offset_seconds: int = 0) -> str:
    dt = base + timedelta(seconds=offset_seconds)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sample(
    base: datetime,
    offset_seconds: int,
    *,
    success: bool = True,
    latency_ms: float | None = 20.0,
    jitter_ms: float | None = 1.0,
    host: str = "1.1.1.1",
) -> dict:
    return {
        "ts": ts_at(base, offset_seconds),
        "host": host,
        "success": success,
        "latency_ms": latency_ms if success else None,
        "jitter_ms": jitter_ms if success else None,
    }
