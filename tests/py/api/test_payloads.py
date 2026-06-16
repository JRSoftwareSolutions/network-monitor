from datetime import datetime, timedelta, timezone

from src.api.payloads import (
    build_metrics_payload,
    build_now_payload,
    tick_display_verdict,
)
from src.metrics.time import parse_ts
from src.verdict import DOWNGRADE_DWELL_SECONDS, VerdictStabilizer

from helpers import sample


class FakeMonitor:
    def __init__(self, samples: list[dict]) -> None:
        self._samples = samples

    def get_samples(self, window_minutes: int) -> list[dict]:
        return self._samples

    def get_latest_sample(self) -> dict | None:
        return self._samples[-1] if self._samples else None

    def get_recent_samples(self, seconds: int = 60) -> list[dict]:
        if not self._samples:
            return []
        latest = parse_ts(self._samples[-1]["ts"])
        cutoff = latest - timedelta(seconds=seconds)
        return [s for s in self._samples if parse_ts(s["ts"]) >= cutoff]


def test_build_now_payload_shape():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, -i, latency_ms=20 + i) for i in range(10)]
    payload = build_now_payload(samples, VerdictStabilizer())
    assert payload["window_seconds"] == 120
    assert "stats" in payload
    assert "indicators" in payload
    assert "display_verdict" in payload
    assert "narrative" in payload


def test_build_metrics_payload_includes_indicator_series():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, -i, latency_ms=20 + (i % 5)) for i in range(20)]
    monitor = FakeMonitor(samples)
    payload = build_metrics_payload(monitor, VerdictStabilizer(), window=15)
    assert "indicator_series" in payload
    assert set(payload["indicator_series"]) == {"ping", "jitter", "loss", "spikes"}
    assert len(payload["indicator_series"]["ping"]) == len(monitor.get_recent_samples(120))


def test_build_metrics_payload_includes_blocks_and_health():
    now = datetime.now(timezone.utc)
    samples = [sample(now, -i * 30, latency_ms=20 + (i % 3)) for i in range(20)]
    monitor = FakeMonitor(samples)
    payload = build_metrics_payload(monitor, VerdictStabilizer(), window=15)
    assert payload["window_minutes"] == 15
    assert "health" in payload
    assert "blocks" in payload
    assert "indicator_series" in payload
    assert payload["latency_distribution"] == {
        "great": 20,
        "good": 0,
        "okay": 0,
        "bad": 0,
        "failed": 0,
    }
    bucket = next((b for b in payload["blocks"]["buckets"] if b.get("sample_count")), None)
    assert bucket is not None
    assert bucket["quality"] in {"good", "fair", "poor", "empty"}


def test_build_metrics_payload_latest_ts_from_store_not_window():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, -i * 60, latency_ms=20) for i in range(5)]
    monitor = FakeMonitor(samples)
    payload = build_metrics_payload(monitor, VerdictStabilizer(), window=1)
    assert payload["latest_ts"] == samples[-1]["ts"]


def test_tick_display_verdict_advances_pending_dwell():
    now = datetime.now(timezone.utc)
    samples = [sample(now, -i, latency_ms=200) for i in range(10)]
    monitor = FakeMonitor(samples)
    stabilizer = VerdictStabilizer(downgrade_dwell_seconds=DOWNGRADE_DWELL_SECONDS)

    stabilizer.update("great", now=now)
    first = tick_display_verdict(
        monitor, stabilizer, now=now + timedelta(seconds=1)
    )
    later = tick_display_verdict(
        monitor, stabilizer, now=now + timedelta(seconds=6)
    )

    assert first["level"] == "great"
    assert first["pending"] is not None
    assert first["pending"]["direction"] == "down"
    assert later["pending"]["for_seconds"] >= 5.0
