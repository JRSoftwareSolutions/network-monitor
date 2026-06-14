from datetime import datetime, timedelta, timezone

from src.indicator_series import compute_indicator_series
from src.sample_utils import filter_samples_since

from helpers import sample


def test_filter_samples_since():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, -120), sample(now, -30), sample(now, 0)]
    cutoff = now - timedelta(seconds=60)
    filtered = filter_samples_since(samples, cutoff)
    assert len(filtered) == 2


def test_compute_indicator_series_aligns_with_samples():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, -i, latency_ms=10 + i) for i in range(5)]
    series = compute_indicator_series(samples, spike_threshold_ms=100.0)
    assert len(series["ping"]) == 5
    assert series["ping"][-1] is not None


def test_spike_threshold_includes_exact_boundary():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [
        sample(now, -10, latency_ms=50),
        sample(now, -5, latency_ms=100),
        sample(now, 0, latency_ms=90),
    ]
    series = compute_indicator_series(samples, spike_threshold_ms=100.0)
    assert series["spikes"][-1] == 6.0
