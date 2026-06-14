"""Shared time-window constants for metrics, verdicts, and indicator series."""

NOW_WINDOW_SECONDS = 120
BASELINE_SECONDS = 60
RECENT_SAMPLES_SECONDS = 60

TREND_RECENT_SECONDS = 120
TREND_PRIOR_SECONDS = 600

INDICATOR_WINDOWS_SECONDS = {
    "ping": 60,
    "jitter": 120,
    "loss": 120,
    "spikes": 120,
}
