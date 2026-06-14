import pytest
from datetime import datetime, timedelta, timezone

from src.metrics_analytics import (
    bucket_samples,
    compute_stats,
    detect_outages,
    downsample_samples,
)

from helpers import sample


def test_compute_stats_empty():
    stats = compute_stats([])
    assert stats["sample_count"] == 0
    assert stats["packet_loss_pct"] == 0.0
    assert stats["latency_avg_ms"] is None


def test_compute_stats_mixed_samples():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [
        sample(now, 0, success=True, latency_ms=10, jitter_ms=1),
        sample(now, 1, success=True, latency_ms=30, jitter_ms=3),
        sample(now, 2, success=False),
    ]
    stats = compute_stats(samples)
    assert stats["sample_count"] == 3
    assert stats["packet_loss_pct"] == pytest.approx(33.33, rel=1e-2)
    assert stats["latency_avg_ms"] == 20.0
    assert stats["jitter_avg_ms"] == 2.0


def test_downsample_samples_preserves_small_sets():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, i, latency_ms=10 + i) for i in range(5)]
    result = downsample_samples(samples, max_points=100)
    assert len(result) == 5


def test_bucket_samples_window():
    end = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(end, -30 + i * 10, latency_ms=20 + i) for i in range(4)]
    buckets = bucket_samples(samples, bucket_seconds=60, window_minutes=5, window_end=end)
    assert buckets
    assert all("ts_start" in bucket and "avg_ms" in bucket for bucket in buckets)


def test_detect_outages_completed():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [
        sample(now, 0, success=True),
        sample(now, 10, success=False),
        sample(now, 20, success=False),
        sample(now, 30, success=True),
    ]
    outages = detect_outages(samples, now=now + timedelta(seconds=60))
    assert len(outages) == 1
    assert outages[0]["ongoing"] is False
    assert outages[0]["duration_seconds"] == 20


def test_detect_outages_ongoing_uses_now_not_last_sample():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [
        sample(now, 0, success=True),
        sample(now, 10, success=False),
        sample(now, 20, success=False),
    ]
    outages = detect_outages(samples, now=now + timedelta(seconds=100))
    assert len(outages) == 1
    assert outages[0]["ongoing"] is True
    assert outages[0]["end_ts"] is None
    assert outages[0]["duration_seconds"] == 90
