from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.metrics.time import (
    clamp_window_minutes,
    floor_to_bucket,
    format_ts,
    parse_ts,
    percentile,
    sort_samples_by_ts,
)
from src.verdict import rate_bucket_quality, rate_ping_ms
from src.metrics.samples import ceil_div, compute_loss_pct, parse_jsonl_sample, sample_quality


WINDOW_OPTIONS = [5, 15, 30, 60, 120]


def compute_window_options(max_log_age_minutes: int) -> list[int]:
    return [option for option in WINDOW_OPTIONS if option <= max_log_age_minutes]


def read_samples(log_file: Path, window_minutes: int) -> list[dict]:
    if not log_file.exists():
        return []

    window_minutes = clamp_window_minutes(window_minutes)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    samples: list[dict] = []

    with log_file.open("r", encoding="utf-8") as handle:
        for line in handle:
            sample = parse_jsonl_sample(line)
            if sample is None:
                continue
            if parse_ts(sample["ts"]) >= cutoff:
                samples.append(sample)

    return sort_samples_by_ts(samples)


def _bucket_starts_backwards(
    end: datetime,
    bucket_seconds: int,
    num_buckets: int,
) -> list[datetime]:
    current_bucket = floor_to_bucket(end, bucket_seconds)
    return [
        current_bucket - timedelta(seconds=bucket_seconds * offset)
        for offset in range(num_buckets - 1, -1, -1)
    ]


def _bucket_starts_for_window(
    *,
    end: datetime,
    window_minutes: int,
    bucket_seconds: int,
) -> list[datetime]:
    window_minutes = clamp_window_minutes(window_minutes)
    num_buckets = max(1, (window_minutes * 60) // bucket_seconds)
    return _bucket_starts_backwards(end, bucket_seconds, num_buckets)


def _bucket_starts_for_span(
    *,
    first_ts: datetime,
    last_ts: datetime,
    bucket_seconds: int,
) -> list[datetime]:
    first_bucket = floor_to_bucket(first_ts, bucket_seconds)
    last_bucket = floor_to_bucket(last_ts, bucket_seconds)
    bucket_starts: list[datetime] = []
    current = first_bucket
    while current <= last_bucket:
        bucket_starts.append(current)
        current += timedelta(seconds=bucket_seconds)
    return bucket_starts


BLOCKS_BUCKET_SECONDS = 60
MAX_CHART_SAMPLES = 1500


def downsample_samples(
    samples: list[dict],
    max_points: int = MAX_CHART_SAMPLES,
    *,
    window_minutes: int | None = None,
    window_end: datetime | None = None,
) -> list[dict]:
    if not samples:
        return []
    samples = sort_samples_by_ts(samples)
    if len(samples) <= max_points:
        return samples

    end = window_end or datetime.now(timezone.utc)

    if window_minutes is not None:
        window_minutes = clamp_window_minutes(window_minutes)
        span_seconds = window_minutes * 60
    else:
        first_ts = parse_ts(samples[0]["ts"])
        last_ts = parse_ts(samples[-1]["ts"])
        span_seconds = max(1, int((last_ts - first_ts).total_seconds()) + 1)

    bucket_seconds = max(1, ceil_div(span_seconds, max_points))

    grouped: dict[datetime, list[dict]] = {}
    for sample in samples:
        bucket_start = floor_to_bucket(parse_ts(sample["ts"]), bucket_seconds)
        grouped.setdefault(bucket_start, []).append(sample)

    if window_minutes is not None:
        num_buckets = ceil_div(span_seconds, bucket_seconds)
        bucket_starts = _bucket_starts_backwards(end, bucket_seconds, num_buckets)
    else:
        first_ts = parse_ts(samples[0]["ts"])
        last_ts = parse_ts(samples[-1]["ts"])
        bucket_starts = _bucket_starts_for_span(
            first_ts=first_ts,
            last_ts=last_ts,
            bucket_seconds=bucket_seconds,
        )

    downsampled: list[dict] = []
    cumulative_failed = 0
    cumulative_total = 0
    for current in bucket_starts:
        chunk = grouped.get(current, [])
        if chunk:
            cumulative_total += len(chunk)
            cumulative_failed += sum(1 for sample in chunk if not sample.get("success"))
            rolling_loss_pct = (
                round((cumulative_failed / cumulative_total) * 100, 2) if cumulative_total else 0.0
            )

            successes = [sample for sample in chunk if sample.get("success")]
            if successes:
                avg_latency = sum(sample["latency_ms"] for sample in successes) / len(successes)
                jitters = [
                    sample["jitter_ms"]
                    for sample in successes
                    if sample.get("jitter_ms") is not None
                ]
                avg_jitter = sum(jitters) / len(jitters) if jitters else None
                downsampled.append(
                    {
                        "ts": format_ts(current),
                        "host": chunk[0].get("host"),
                        "success": True,
                        "latency_ms": round(avg_latency, 2),
                        "jitter_ms": round(avg_jitter, 2) if avg_jitter is not None else None,
                        "rolling_loss_pct": rolling_loss_pct,
                    }
                )
            else:
                downsampled.append(
                    {
                        "ts": format_ts(current),
                        "host": chunk[0].get("host"),
                        "success": False,
                        "latency_ms": None,
                        "jitter_ms": None,
                        "rolling_loss_pct": rolling_loss_pct,
                    }
                )

    return downsampled


def _summarize_bucket(bucket_samples_list: list[dict]) -> dict:
    latencies, jitters, failed, total = sample_quality(bucket_samples_list)

    bucket: dict = {
        "sample_count": total,
        "failed_count": failed,
        "loss_pct": compute_loss_pct(failed, total),
        "open_ms": None,
        "high_ms": None,
        "low_ms": None,
        "close_ms": None,
        "avg_ms": None,
        "jitter_avg_ms": None,
    }

    if latencies:
        bucket.update(
            {
                "open_ms": round(latencies[0], 2),
                "high_ms": round(max(latencies), 2),
                "low_ms": round(min(latencies), 2),
                "close_ms": round(latencies[-1], 2),
                "avg_ms": round(sum(latencies) / len(latencies), 2),
                "jitter_avg_ms": round(sum(jitters) / len(jitters), 2) if jitters else None,
            }
        )

    return bucket


def bucket_samples(
    samples: list[dict],
    bucket_seconds: int = BLOCKS_BUCKET_SECONDS,
    *,
    window_minutes: int | None = None,
    window_end: datetime | None = None,
) -> list[dict]:
    bucket_seconds = max(1, int(bucket_seconds))
    end = window_end or datetime.now(timezone.utc)

    grouped: dict[datetime, list[dict]] = {}
    for sample in samples:
        ts = parse_ts(sample["ts"])
        bucket_start = floor_to_bucket(ts, bucket_seconds)
        grouped.setdefault(bucket_start, []).append(sample)

    if window_minutes is not None:
        bucket_starts = _bucket_starts_for_window(
            end=end,
            window_minutes=window_minutes,
            bucket_seconds=bucket_seconds,
        )
    else:
        bucket_starts = sorted(grouped.keys())

    buckets: list[dict] = []
    for bucket_start in bucket_starts:
        bucket_end = bucket_start + timedelta(seconds=bucket_seconds)
        summary = _summarize_bucket(grouped.get(bucket_start, []))
        buckets.append(
            {
                "ts_start": format_ts(bucket_start),
                "ts_end": format_ts(bucket_end),
                "quality": rate_bucket_quality(summary),
                **summary,
            }
        )

    return buckets


def compute_latency_distribution(samples: list[dict]) -> dict[str, int]:
    counts = {"great": 0, "good": 0, "okay": 0, "bad": 0, "failed": 0}
    for sample in samples:
        if not sample.get("success") or sample.get("latency_ms") is None:
            counts["failed"] += 1
            continue
        counts[rate_ping_ms(sample["latency_ms"])] += 1
    return counts


def compute_stats(samples: list[dict]) -> dict:
    if not samples:
        return {
            "packet_loss_pct": 0.0,
            "uptime_pct": 100.0,
            "latency_avg_ms": None,
            "latency_min_ms": None,
            "latency_max_ms": None,
            "latency_p95_ms": None,
            "jitter_avg_ms": None,
            "sample_count": 0,
        }

    latencies, jitters, failed, total = sample_quality(samples)
    loss_pct = compute_loss_pct(failed, total)

    return {
        "packet_loss_pct": loss_pct,
        "uptime_pct": round(100.0 - loss_pct, 2),
        "latency_avg_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
        "latency_min_ms": round(min(latencies), 2) if latencies else None,
        "latency_max_ms": round(max(latencies), 2) if latencies else None,
        "latency_p95_ms": round(percentile(latencies, 95), 2) if latencies else None,
        "jitter_avg_ms": round(sum(jitters) / len(jitters), 2) if jitters else None,
        "sample_count": total,
    }


def detect_outages(samples: list[dict], *, now: datetime | None = None) -> list[dict]:
    if not samples:
        return []

    now_dt = now or datetime.now(timezone.utc)
    outages: list[dict] = []
    outage_start: str | None = None
    outage_count = 0

    for sample in samples:
        if not sample.get("success"):
            if outage_start is None:
                outage_start = sample["ts"]
            outage_count += 1
            continue

        if outage_start is not None:
            outages.append(
                _build_outage(outage_start, sample["ts"], outage_count, ongoing=False)
            )
            outage_start = None
            outage_count = 0

    if outage_start is not None:
        end_ts = format_ts(now_dt)
        outages.append(
            _build_outage(outage_start, end_ts, outage_count, ongoing=True, now=now_dt)
        )

    return list(reversed(outages))


def _build_outage(
    start_ts: str,
    end_ts: str,
    failed_count: int,
    *,
    ongoing: bool,
    now: datetime | None = None,
) -> dict:
    start = parse_ts(start_ts)
    if ongoing:
        end = now or datetime.now(timezone.utc)
    else:
        end = parse_ts(end_ts)
    duration_seconds = max(0, int((end - start).total_seconds()))

    return {
        "start_ts": start_ts,
        "end_ts": None if ongoing else end_ts,
        "duration_seconds": duration_seconds,
        "failed_count": failed_count,
        "ongoing": ongoing,
    }
