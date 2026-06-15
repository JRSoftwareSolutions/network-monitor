from datetime import datetime, timezone
from unittest.mock import patch

from src.monitoring.sample_store import SampleStore

from helpers import sample


def test_get_recent_seconds_uses_time_not_count():
    base = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    fixed_epoch = base.timestamp()
    store = SampleStore(max_age_minutes=180)

    with patch("src.monitoring.sample_store.utc_now_ts", return_value=fixed_epoch):
        # 10 samples every 10s over 90s — count-based slice of 60 would keep only 6.
        for i in range(10):
            store.append(sample(base, -90 + i * 10, latency_ms=20))

        recent = store.get_recent_seconds(60)
        assert len(recent) == 7
        assert recent[0]["ts"] == sample(base, -60, latency_ms=20)["ts"]
        assert recent[-1]["ts"] == sample(base, 0, latency_ms=20)["ts"]


def test_get_recent_count_still_works():
    base = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    fixed_epoch = base.timestamp()
    store = SampleStore(max_age_minutes=180)

    with patch("src.monitoring.sample_store.utc_now_ts", return_value=fixed_epoch):
        for i in range(5):
            store.append(sample(base, -i * 5, latency_ms=20))

        recent = store.get_recent(3)
        assert len(recent) == 3
        assert recent[-1]["ts"] == sample(base, -10, latency_ms=20)["ts"]
