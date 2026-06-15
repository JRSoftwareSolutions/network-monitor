from pathlib import Path

from src.metrics.constants import gaming_thresholds_payload

ROOT = Path(__file__).resolve().parents[3]
RATING_JS = ROOT / "static" / "js" / "dashboard-rating.js"


def test_gaming_thresholds_payload_shape():
    payload = gaming_thresholds_payload()
    for key in ("ping", "jitter", "loss", "spikes"):
        tiers = payload[key]
        assert set(tiers) == {"great", "good", "okay", "max"}
        assert tiers["great"] <= tiers["good"] <= tiers["okay"] <= tiers["max"]


def test_gaming_thresholds_match_verdict_cutoffs():
    payload = gaming_thresholds_payload()
    assert payload["ping"] == {"great": 40, "good": 70, "okay": 110, "max": 200}
    assert payload["jitter"] == {"great": 8, "good": 15, "okay": 30, "max": 60}
    assert payload["loss"] == {"great": 0, "good": 1, "okay": 3, "max": 15}
    assert payload["spikes"] == {"great": 0, "good": 1, "okay": 4, "max": 10}


def test_dashboard_rating_js_contains_python_thresholds():
    text = RATING_JS.read_text(encoding="utf-8")
    payload = gaming_thresholds_payload()
    for metric, tiers in payload.items():
        for name, value in tiers.items():
            assert f"{name}: {value}" in text, f"missing {metric}.{name}={value} in dashboard-rating.js"
