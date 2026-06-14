"""Shared rating thresholds for gaming verdicts, health chips, and UI scales."""

# Gaming tiers (great / good / okay / bad) — upper bounds for great and good, okay.
GAMING_PING_GREAT = 40
GAMING_PING_GOOD = 70
GAMING_PING_OKAY = 110
GAMING_PING_MAX = 200

GAMING_JITTER_GREAT = 8
GAMING_JITTER_GOOD = 15
GAMING_JITTER_OKAY = 30
GAMING_JITTER_MAX = 60

GAMING_LOSS_GOOD = 1
GAMING_LOSS_OKAY = 3
GAMING_LOSS_MAX = 15

GAMING_SPIKE_GOOD = 1
GAMING_SPIKE_OKAY = 4
GAMING_SPIKE_MAX = 10

# Window health chip (healthy / degraded / poor / offline).
HEALTH_LATENCY_DEGRADED = 80
HEALTH_LATENCY_POOR = 200
HEALTH_JITTER_DEGRADED = 20
HEALTH_JITTER_POOR = 50
HEALTH_LOSS_DEGRADED = 1
HEALTH_LOSS_POOR = 10
HEALTH_LOSS_OFFLINE = 50


def gaming_thresholds_payload() -> dict:
    """Thresholds exposed to the dashboard so client tiers stay in sync."""
    return {
        "ping": {
            "great": GAMING_PING_GREAT,
            "good": GAMING_PING_GOOD,
            "okay": GAMING_PING_OKAY,
            "max": GAMING_PING_MAX,
        },
        "jitter": {
            "great": GAMING_JITTER_GREAT,
            "good": GAMING_JITTER_GOOD,
            "okay": GAMING_JITTER_OKAY,
            "max": GAMING_JITTER_MAX,
        },
        "loss": {
            "great": 0,
            "good": GAMING_LOSS_GOOD,
            "okay": GAMING_LOSS_OKAY,
            "max": GAMING_LOSS_MAX,
        },
        "spikes": {
            "great": 0,
            "good": GAMING_SPIKE_GOOD,
            "okay": GAMING_SPIKE_OKAY,
            "max": GAMING_SPIKE_MAX,
        },
    }
