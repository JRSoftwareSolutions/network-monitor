from datetime import datetime, timezone
from functools import lru_cache


@lru_cache(maxsize=8192)
def parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def clamp_window_minutes(window_minutes: int) -> int:
    return max(1, min(1440, window_minutes))


def format_ts(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sort_samples_by_ts(samples: list[dict]) -> list[dict]:
    """Return samples in chronological order (stable for equal timestamps)."""
    if len(samples) < 2:
        return samples
    return sorted(samples, key=lambda sample: parse_ts(sample["ts"]))


def floor_to_bucket(ts: datetime, bucket_seconds: int) -> datetime:
    epoch = int(ts.timestamp())
    bucket_start = (epoch // bucket_seconds) * bucket_seconds
    return datetime.fromtimestamp(bucket_start, tz=timezone.utc)


def percentile(values: list[float], pct: float) -> float:
    if not values:
        raise ValueError("empty values")
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, int((pct / 100) * len(sorted_values) + 0.999999) - 1)
    index = max(0, index)
    return sorted_values[index]


def median(values: list[float]) -> float:
    if not values:
        raise ValueError("empty values")
    sorted_values = sorted(values)
    count = len(sorted_values)
    mid = count // 2
    if count % 2:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2
