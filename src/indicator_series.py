from datetime import datetime, timedelta

from src.metrics_time import median, parse_ts
from src.metrics_windows import INDICATOR_WINDOWS_SECONDS
from src.sample_utils import compute_loss_pct, filter_samples_since


def _rollup_median(values: list[float]) -> float | None:
    if not values:
        return None
    return round(median(values), 2)


def _rolling_series(
    samples: list[dict],
    window_seconds: int,
    reducer,
) -> list[float | None]:
    if not samples:
        return []
    results: list[float | None] = []
    for index in range(len(samples)):
        end_ts = parse_ts(samples[index]["ts"])
        cutoff = end_ts - timedelta(seconds=window_seconds)
        window = filter_samples_since(samples[: index + 1], cutoff)
        results.append(reducer(window, end_ts))
    return results


def compute_indicator_series(
    samples: list[dict],
    *,
    spike_threshold_ms: float | None,
) -> dict[str, list[float | None]]:
    """Rolling indicator values aligned to each sample — for dashboard sparklines."""
    ping = _rolling_series(
        samples,
        INDICATOR_WINDOWS_SECONDS["ping"],
        lambda window, _end: _rollup_median(
            [s["latency_ms"] for s in window if s.get("success") and s.get("latency_ms") is not None]
        ),
    )
    jitter = _rolling_series(
        samples,
        INDICATOR_WINDOWS_SECONDS["jitter"],
        lambda window, _end: (
            round(
                sum(s["jitter_ms"] for s in window if s.get("jitter_ms") is not None)
                / len([s for s in window if s.get("jitter_ms") is not None]),
                2,
            )
            if any(s.get("jitter_ms") is not None for s in window)
            else None
        ),
    )
    loss = _rolling_series(
        samples,
        INDICATOR_WINDOWS_SECONDS["loss"],
        lambda window, _end: compute_loss_pct(
            sum(1 for s in window if not s.get("success")),
            len(window),
        )
        if window
        else None,
    )

    if spike_threshold_ms is None:
        spikes = [None] * len(samples)
    else:
        spikes = _rolling_series(
            samples,
            INDICATOR_WINDOWS_SECONDS["spikes"],
            lambda window, end_ts: _spike_rate_per_min(window, end_ts, spike_threshold_ms),
        )

    return {"ping": ping, "jitter": jitter, "loss": loss, "spikes": spikes}


def _spike_rate_per_min(
    window: list[dict],
    end_ts: datetime,
    spike_threshold_ms: float,
) -> float | None:
    if len(window) < 2:
        return None
    start_ts = parse_ts(window[0]["ts"])
    duration_min = (end_ts - start_ts).total_seconds() / 60.0
    if duration_min < 0.05:
        return None
    spike_count = sum(
        1
        for sample in window
        if sample.get("success")
        and sample.get("latency_ms") is not None
        and sample["latency_ms"] >= spike_threshold_ms
    )
    return round(spike_count / duration_min, 2)
