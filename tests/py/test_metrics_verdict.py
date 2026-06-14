import pytest
from datetime import datetime, timedelta, timezone

from src.metrics_verdict import (
    DOWNGRADE_DWELL_SECONDS,
    UPGRADE_DWELL_SECONDS,
    VerdictStabilizer,
    compute_health,
    compute_instant_verdict,
    compute_now_stats,
    rate_loss_pct,
    rate_spike_rate,
)

from helpers import sample


def test_rate_loss_pct():
    assert rate_loss_pct(0) == "great"
    assert rate_loss_pct(0.5) == "good"
    assert rate_loss_pct(2) == "okay"
    assert rate_loss_pct(10) == "bad"


def test_rate_spike_rate():
    assert rate_spike_rate(0) == "great"
    assert rate_spike_rate(0.5) == "good"
    assert rate_spike_rate(3) == "okay"
    assert rate_spike_rate(5) == "bad"


def test_compute_health_no_data():
    result = compute_health({"sample_count": 0})
    assert result["level"] == "no_data"


def test_compute_health_offline_on_high_loss():
    result = compute_health({"sample_count": 10, "packet_loss_pct": 55.0})
    assert result["level"] == "offline"


def test_compute_now_stats_counts_failures():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [
        sample(now, -30, success=True, latency_ms=20),
        sample(now, -10, success=False),
        sample(now, -5, success=False),
    ]
    stats = compute_now_stats(samples, now=now)
    assert stats["sample_count"] == 3
    assert stats["loss_pct"] == pytest.approx(66.67, rel=1e-2)
    assert stats["tail_failures"] == 2


def test_compute_instant_verdict_offline_on_tail_failures():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [
        sample(now, -40, success=True, latency_ms=20),
        sample(now, -20, success=False),
        sample(now, -10, success=False),
        sample(now, -5, success=False),
    ]
    now_stats = compute_now_stats(samples, now=now)
    flow = {"baseline_ms": 20, "spike_count": 0, "spike_rate_per_min": 0.0, "worst_spike": None}
    verdict = compute_instant_verdict(now_stats, flow)
    assert verdict["level"] == "offline"


def test_verdict_stabilizer_downgrade_requires_dwell():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    stabilizer = VerdictStabilizer(
        downgrade_dwell_seconds=DOWNGRADE_DWELL_SECONDS,
        upgrade_dwell_seconds=UPGRADE_DWELL_SECONDS,
    )

    first = stabilizer.update("great", now=now)
    assert first["level"] == "great"

    pending = stabilizer.update("bad", now=now + timedelta(seconds=1))
    assert pending["level"] == "great"
    assert pending["pending"]["direction"] == "down"

    committed = stabilizer.update(
        "bad", now=now + timedelta(seconds=1 + DOWNGRADE_DWELL_SECONDS)
    )
    assert committed["level"] == "bad"
    assert committed["pending"] is None


def test_verdict_stabilizer_offline_commits_immediately():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    stabilizer = VerdictStabilizer()
    stabilizer.update("good", now=now)
    result = stabilizer.update("offline", now=now + timedelta(seconds=1))
    assert result["level"] == "offline"

