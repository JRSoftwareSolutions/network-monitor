import json
from datetime import datetime

from src.metrics.time import parse_ts


def parse_jsonl_sample(line: str) -> dict | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        sample = json.loads(stripped)
        parse_ts(sample["ts"])
        return sample
    except (json.JSONDecodeError, KeyError, ValueError):
        return None


def filter_samples_since(samples: list[dict], cutoff: datetime) -> list[dict]:
    return [sample for sample in samples if parse_ts(sample["ts"]) >= cutoff]


def compute_loss_pct(failed: int, total: int) -> float:
    return round((failed / total) * 100, 2) if total else 0.0


def window_avg_latency_and_loss(samples: list[dict]) -> tuple[float | None, float]:
    latencies, _, failed, total = sample_quality(samples)
    avg = sum(latencies) / len(latencies) if latencies else None
    return avg, compute_loss_pct(failed, total)


def sample_quality(samples: list[dict]) -> tuple[list[float], list[float], int, int]:
    latencies = [
        sample["latency_ms"]
        for sample in samples
        if sample.get("success") and sample.get("latency_ms") is not None
    ]
    jitters = [sample["jitter_ms"] for sample in samples if sample.get("jitter_ms") is not None]
    failed = sum(1 for sample in samples if not sample.get("success"))
    total = len(samples)
    return latencies, jitters, failed, total


def ceil_div(a: int, b: int) -> int:
    """Integer ceiling division for positive integers."""
    return max(1, -(-a // b))
