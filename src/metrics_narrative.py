from datetime import datetime, timedelta, timezone

from src.metrics_time import parse_ts

TREND_RECENT_SECONDS = 120
TREND_PRIOR_SECONDS = 600
TREND_MIN_SAMPLES = 12
TREND_LATENCY_DELTA_MS = 5.0
TREND_LATENCY_DELTA_RATIO = 0.15
TREND_LOSS_DELTA_PCT = 1.0

_NARRATIVE_HEADLINES = {
    "great": "Rock solid",
    "good": "Stable",
    "okay": "A bit shaky",
    "bad": "Unstable",
    "offline": "Connection down",
    "no_data": "Waiting for data",
}

_QUALITY_PHRASES = {
    "great": "ideal for competitive play",
    "good": "smooth for nearly any game",
    "okay": "playable, but fast-paced games may feel it",
    "bad": "expect noticeable lag in real-time games",
}

_TREND_SENTENCES = {
    "improving": "Conditions are improving compared with the previous 10 minutes.",
    "degrading": "Conditions are worse than the previous 10 minutes - keep an eye on it.",
}


def _window_quality(samples: list[dict]) -> tuple[float | None, float]:
    total = len(samples)
    failed = sum(1 for sample in samples if not sample.get("success"))
    latencies = [
        sample["latency_ms"]
        for sample in samples
        if sample.get("success") and sample.get("latency_ms") is not None
    ]
    avg = sum(latencies) / len(latencies) if latencies else None
    loss = (failed / total) * 100 if total else 0.0
    return avg, loss


def compute_trend(
    samples: list[dict],
    *,
    now: datetime | None = None,
    recent_seconds: int = TREND_RECENT_SECONDS,
    prior_seconds: int = TREND_PRIOR_SECONDS,
) -> dict:
    """Compare the last `recent_seconds` against the `prior_seconds` before them."""
    now_dt = now or datetime.now(timezone.utc)
    recent_cutoff = now_dt - timedelta(seconds=recent_seconds)
    prior_cutoff = recent_cutoff - timedelta(seconds=prior_seconds)

    recent: list[dict] = []
    prior: list[dict] = []
    for sample in samples:
        ts = parse_ts(sample["ts"])
        if ts >= recent_cutoff:
            recent.append(sample)
        elif ts >= prior_cutoff:
            prior.append(sample)

    if len(recent) < TREND_MIN_SAMPLES or len(prior) < TREND_MIN_SAMPLES:
        return {"direction": "unknown", "latency_delta_ms": None, "loss_delta_pct": None}

    recent_avg, recent_loss = _window_quality(recent)
    prior_avg, prior_loss = _window_quality(prior)

    latency_delta = None
    latency_signal = 0
    if recent_avg is not None and prior_avg is not None:
        latency_delta = round(recent_avg - prior_avg, 1)
        threshold = max(TREND_LATENCY_DELTA_MS, prior_avg * TREND_LATENCY_DELTA_RATIO)
        if latency_delta <= -threshold:
            latency_signal = -1
        elif latency_delta >= threshold:
            latency_signal = 1

    loss_delta = round(recent_loss - prior_loss, 2)
    loss_signal = 0
    if loss_delta <= -TREND_LOSS_DELTA_PCT:
        loss_signal = -1
    elif loss_delta >= TREND_LOSS_DELTA_PCT:
        loss_signal = 1

    if latency_signal == 1 or loss_signal == 1:
        direction = "degrading"
    elif latency_signal == -1 or loss_signal == -1:
        direction = "improving"
    else:
        direction = "steady"

    return {
        "direction": direction,
        "latency_delta_ms": latency_delta,
        "loss_delta_pct": loss_delta,
    }


def _format_seconds_ago(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    if seconds < 5:
        return "just now"
    if seconds < 90:
        return f"{seconds}s ago"
    return f"{round(seconds / 60)} min ago"


def build_status_narrative(
    *,
    now_stats: dict,
    flow: dict,
    verdict: dict,
    display: dict | None = None,
    trend: dict | None = None,
    now: datetime | None = None,
) -> dict:
    """Plain-language explanation of what is happening and why it matters in-game."""
    from src.metrics_verdict import NOW_OFFLINE_TAIL_FAILURES, rate_loss_pct, rate_spike_rate

    now_dt = now or datetime.now(timezone.utc)

    chips = [
        {"key": key, "label": indicator["text"], "level": indicator["level"]}
        for key, indicator in verdict.get("indicators", {}).items()
    ]

    level = verdict["level"]

    if level == "no_data":
        return {
            "headline": _NARRATIVE_HEADLINES["no_data"],
            "summary": "no samples in the last 2 minutes",
            "sentences": [
                "No pings recorded in the last 2 minutes - the monitor may still be warming up."
            ],
            "chips": [],
        }

    if level == "offline":
        tail_failures = now_stats.get("tail_failures", 0)
        seconds_since = now_stats.get("seconds_since_success")
        sentences = []
        if tail_failures >= NOW_OFFLINE_TAIL_FAILURES:
            sentences.append(
                f"Your connection looks down - the last {tail_failures} pings all failed."
            )
        else:
            sentences.append("Your connection looks down - nothing is getting through right now.")
        if seconds_since is not None:
            sentences.append(f"The last successful ping was {_format_seconds_ago(seconds_since)}.")
        sentences.append("Online games will freeze or disconnect until this recovers.")
        return {
            "headline": _NARRATIVE_HEADLINES["offline"],
            "summary": "no response from the target host",
            "sentences": sentences,
            "chips": chips,
        }

    sentences = []

    baseline_ms = flow.get("baseline_ms")
    jitter_ms = now_stats.get("jitter_ms")
    if baseline_ms is not None:
        opener = f"Baseline ping is {baseline_ms:.0f} ms"
        if jitter_ms is not None:
            opener += f" with {jitter_ms:.1f} ms of jitter"
        quality = _QUALITY_PHRASES.get(level, _QUALITY_PHRASES["okay"])
        sentences.append(f"{opener} - {quality}.")

    spike_count = flow.get("spike_count", 0)
    worst_spike = flow.get("worst_spike")
    spike_rate = flow.get("spike_rate_per_min") or 0.0
    if not spike_count:
        sentences.append("No latency spikes in the last 2 minutes.")
    elif worst_spike is not None:
        worst_ms = worst_spike["latency_ms"]
        ago = _format_seconds_ago((now_dt - parse_ts(worst_spike["ts"])).total_seconds())
        if spike_count == 1:
            sentences.append(
                f"One spike to {worst_ms:.0f} ms {ago} - an isolated blip like that is a "
                "single micro-hitch, not real lag."
            )
        elif rate_spike_rate(spike_rate) in ("good", "okay"):
            sentences.append(
                f"{spike_count} spikes in the last 2 minutes (worst {worst_ms:.0f} ms, {ago}) "
                "- you may feel the occasional hitch."
            )
        else:
            sentences.append(
                f"{spike_count} spikes in the last 2 minutes - frequent enough to cause "
                "rubber-banding in game."
            )

    loss_pct = now_stats.get("loss_pct", 0.0)
    if loss_pct > 0:
        loss_level = rate_loss_pct(loss_pct)
        if loss_level == "good":
            sentences.append(f"Packet loss is {loss_pct:.1f}% - negligible.")
        elif loss_level == "okay":
            sentences.append(
                f"Packet loss is {loss_pct:.1f}% - enough for the odd hiccup; an action may "
                "occasionally not register."
            )
        else:
            sentences.append(
                f"Packet loss is {loss_pct:.1f}% - this hurts gameplay more than raw ping; "
                "expect misfires and warping."
            )

    trend_sentence = _TREND_SENTENCES.get((trend or {}).get("direction", ""))
    if trend_sentence:
        sentences.append(trend_sentence)

    pending = (display or {}).get("pending")
    if pending:
        remaining = max(0.0, pending["needed_seconds"] - pending["for_seconds"])
        if pending["direction"] == "up":
            sentences.append(
                f"Things look better than the verdict shows - confirming for another "
                f"{remaining:.0f}s before upgrading."
            )
        else:
            sentences.append(
                f"Watching a possible slowdown - the verdict drops in {remaining:.0f}s "
                "if it keeps up."
            )

    summary_parts = []
    if baseline_ms is not None:
        summary_parts.append(f"baseline {baseline_ms:.0f} ms")
    if jitter_ms is not None:
        summary_parts.append(f"jitter {jitter_ms:.1f} ms")
    summary_parts.append(f"loss {loss_pct:.1f}%")
    if spike_count:
        plural = "s" if spike_count != 1 else ""
        summary_parts.append(f"{spike_count} spike{plural}")
    else:
        summary_parts.append("no spikes")

    return {
        "headline": _NARRATIVE_HEADLINES.get(level, _NARRATIVE_HEADLINES["okay"]),
        "summary": " · ".join(summary_parts),
        "sentences": sentences,
        "chips": chips,
    }
