from datetime import datetime, timezone

from src.api_payloads import build_live_payload, build_metrics_payload, build_now_payload
from src.metrics_verdict import VerdictStabilizer

from helpers import sample


class FakeMonitor:
    def __init__(self, samples: list[dict]) -> None:
        self._samples = samples

    def get_samples(self, window_minutes: int) -> list[dict]:
        return self._samples

    def get_latest_sample(self) -> dict | None:
        return self._samples[-1] if self._samples else None

    def get_recent_samples(self, count: int = 60) -> list[dict]:
        return self._samples[-count:]


def test_build_now_payload_shape():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, -i, latency_ms=20 + i) for i in range(10)]
    payload = build_now_payload(samples, VerdictStabilizer())
    assert payload["window_seconds"] == 120
    assert "stats" in payload
    assert "indicators" in payload
    assert "display_verdict" in payload
    assert "narrative" in payload


def test_build_live_payload_includes_indicator_series():
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    samples = [sample(now, -i, latency_ms=20 + (i % 5)) for i in range(20)]
    monitor = FakeMonitor(samples)
    payload = build_live_payload(monitor, VerdictStabilizer())
    assert "indicator_series" in payload
    assert set(payload["indicator_series"]) == {"ping", "jitter", "loss", "spikes"}
    assert len(payload["indicator_series"]["ping"]) == len(samples[-60:])


def test_build_metrics_payload_includes_blocks_and_health():
    now = datetime.now(timezone.utc)
    samples = [sample(now, -i * 30, latency_ms=20 + (i % 3)) for i in range(20)]
    monitor = FakeMonitor(samples)
    payload = build_metrics_payload(monitor, VerdictStabilizer(), window=15)
    assert payload["window_minutes"] == 15
    assert "health" in payload
    assert "blocks" in payload
    assert "indicator_series" in payload
    bucket = next((b for b in payload["blocks"]["buckets"] if b.get("sample_count")), None)
    assert bucket is not None
    assert bucket["quality"] in {"good", "fair", "poor", "empty"}
