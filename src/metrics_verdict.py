import threading
from datetime import datetime, timedelta, timezone

from src.metrics_constants import (
    GAMING_JITTER_GOOD,
    GAMING_JITTER_GREAT,
    GAMING_JITTER_OKAY,
    GAMING_LOSS_GOOD,
    GAMING_LOSS_OKAY,
    GAMING_PING_GOOD,
    GAMING_PING_GREAT,
    GAMING_PING_OKAY,
    GAMING_SPIKE_GOOD,
    GAMING_SPIKE_OKAY,
    HEALTH_JITTER_DEGRADED,
    HEALTH_JITTER_POOR,
    HEALTH_LATENCY_DEGRADED,
    HEALTH_LATENCY_POOR,
    HEALTH_LOSS_DEGRADED,
    HEALTH_LOSS_OFFLINE,
    HEALTH_LOSS_POOR,
)
from src.metrics_time import median, parse_ts
from src.sample_utils import filter_samples_since, sample_quality


_HEALTH_LABELS = {
    "healthy": "Healthy",
    "degraded": "Degraded",
    "poor": "Poor",
    "offline": "Offline",
    "no_data": "No data",
}
_SEVERITY_RANK = {"healthy": 0, "degraded": 1, "poor": 2, "offline": 3}


def _loss_severity(packet_loss_pct: float) -> tuple[str, str | None]:
    if packet_loss_pct >= HEALTH_LOSS_OFFLINE:
        return "offline", f"packet loss {packet_loss_pct:.1f}%"
    if packet_loss_pct >= HEALTH_LOSS_POOR:
        return "poor", f"packet loss {packet_loss_pct:.1f}%"
    if packet_loss_pct >= HEALTH_LOSS_DEGRADED:
        return "degraded", f"packet loss {packet_loss_pct:.1f}%"
    return "healthy", None


def _latency_severity(latency_avg_ms: float) -> tuple[str, str | None]:
    if latency_avg_ms >= HEALTH_LATENCY_POOR:
        return "poor", f"avg latency {latency_avg_ms:.1f} ms"
    if latency_avg_ms >= HEALTH_LATENCY_DEGRADED:
        return "degraded", f"avg latency {latency_avg_ms:.1f} ms"
    return "healthy", None


def _jitter_severity(jitter_avg_ms: float) -> tuple[str, str | None]:
    if jitter_avg_ms >= HEALTH_JITTER_POOR:
        return "poor", f"avg jitter {jitter_avg_ms:.1f} ms"
    if jitter_avg_ms >= HEALTH_JITTER_DEGRADED:
        return "degraded", f"avg jitter {jitter_avg_ms:.1f} ms"
    return "healthy", None


NOW_WINDOW_SECONDS = 120
NOW_OFFLINE_TAIL_FAILURES = 3
NOW_STALE_SUCCESS_SECONDS = 30

# Baseline = rolling median of recent successful pings; spikes are measured
# against it so a stable-but-high or stable-but-low connection is judged fairly.
BASELINE_SECONDS = 60
MIN_BASELINE_SAMPLES = 5
SPIKE_FACTOR = 2.5
SPIKE_MIN_DELTA_MS = 80.0

# Hysteresis dwell times for the displayed verdict.
DOWNGRADE_DWELL_SECONDS = 8.0
UPGRADE_DWELL_SECONDS = 20.0

# Trend: compare the last 2 minutes against the 10 minutes before them.

_GAMING_LABELS = {
    "great": "Great for gaming",
    "good": "Good to game",
    "okay": "Playable, expect hiccups",
    "bad": "Rough - expect lag",
    "offline": "Offline",
    "no_data": "No data",
}
_GAMING_RANK = {"great": 0, "good": 1, "okay": 2, "bad": 3}


def compute_now_stats(
    samples: list[dict],
    *,
    now: datetime | None = None,
    window_seconds: int = NOW_WINDOW_SECONDS,
) -> dict:
    """Stats over the trailing `window_seconds` - the 'can I game right now?' window."""
    now_dt = now or datetime.now(timezone.utc)
    cutoff = now_dt - timedelta(seconds=window_seconds)
    recent = filter_samples_since(samples, cutoff)

    total = len(recent)
    latencies, jitters, failed, _ = sample_quality(recent)

    tail_failures = 0
    for sample in reversed(recent):
        if sample.get("success"):
            break
        tail_failures += 1

    seconds_since_success: float | None = None
    for sample in reversed(recent):
        if sample.get("success"):
            seconds_since_success = max(0.0, (now_dt - parse_ts(sample["ts"])).total_seconds())
            break

    latest = recent[-1] if recent else None
    latest_success = bool(latest.get("success")) if latest else None

    return {
        "sample_count": total,
        "ping_ms": latest["latency_ms"] if latest and latest.get("success") else None,
        "latest_success": latest_success,
        "avg_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
        "max_ms": round(max(latencies), 2) if latencies else None,
        "jitter_ms": round(sum(jitters) / len(jitters), 2) if jitters else None,
        "loss_pct": round((failed / total) * 100, 2) if total else 0.0,
        "tail_failures": tail_failures,
        "seconds_since_success": (
            round(seconds_since_success, 1) if seconds_since_success is not None else None
        ),
    }


def _rate_scale(value: float, great: float, good: float, okay: float) -> str:
    if value < great:
        return "great"
    if value < good:
        return "good"
    if value < okay:
        return "okay"
    return "bad"


def rate_loss_pct(loss_pct: float) -> str:
    if loss_pct <= 0:
        return "great"
    if loss_pct < GAMING_LOSS_GOOD:
        return "good"
    if loss_pct <= GAMING_LOSS_OKAY:
        return "okay"
    return "bad"


def rate_spike_rate(rate_per_min: float) -> str:
    if rate_per_min <= 0:
        return "great"
    if rate_per_min < GAMING_SPIKE_GOOD:
        return "good"
    if rate_per_min <= GAMING_SPIKE_OKAY:
        return "okay"
    return "bad"


def rate_bucket_quality(bucket: dict) -> str:
    """Timeline/chart quality label (good/fair/poor/empty)."""
    if not bucket or not bucket.get("sample_count"):
        return "empty"
    loss = bucket.get("loss_pct") or 0
    avg = bucket.get("avg_ms")
    jit = bucket.get("jitter_avg_ms")
    if loss > GAMING_LOSS_OKAY or (avg is not None and avg >= GAMING_PING_OKAY) or (
        jit is not None and jit >= GAMING_JITTER_OKAY
    ):
        return "poor"
    if loss >= GAMING_LOSS_GOOD or (avg is not None and avg >= GAMING_PING_GOOD) or (
        jit is not None and jit >= GAMING_JITTER_GOOD
    ):
        return "fair"
    return "good"


_INDICATOR_MEANINGS = {
    "ping": {
        "great": "esports-ready response",
        "good": "smooth in any game",
        "okay": "noticeable in fast games",
        "bad": "you'll feel the delay",
    },
    "jitter": {
        "great": "rock-steady timing",
        "good": "barely noticeable",
        "okay": "minor stutter possible",
        "bad": "rubber-banding likely",
    },
    "loss": {
        "great": "no packets dropped",
        "good": "negligible drops",
        "okay": "occasional hiccups",
        "bad": "actions will misfire",
    },
    "spikes": {
        "great": "no spikes",
        "good": "isolated blips, you won't feel them",
        "okay": "occasional hitches",
        "bad": "frequent rubber-banding",
    },
}


def compute_baseline_and_spikes(
    samples: list[dict],
    *,
    now: datetime | None = None,
    window_seconds: int = NOW_WINDOW_SECONDS,
    baseline_seconds: int = BASELINE_SECONDS,
) -> dict:
    """Rolling-median baseline plus spike detection over the now window.

    A ping counts as a spike when it exceeds max(SPIKE_FACTOR x baseline,
    baseline + SPIKE_MIN_DELTA_MS). What matters for gameplay is the spike
    *rate*, not the single worst value.
    """
    now_dt = now or datetime.now(timezone.utc)
    cutoff = now_dt - timedelta(seconds=window_seconds)
    recent = [
        sample
        for sample in filter_samples_since(samples, cutoff)
        if sample.get("success")
        and sample.get("latency_ms") is not None
    ]

    baseline_cutoff = now_dt - timedelta(seconds=baseline_seconds)
    baseline_pool = [
        sample["latency_ms"] for sample in recent if parse_ts(sample["ts"]) >= baseline_cutoff
    ]
    if len(baseline_pool) < MIN_BASELINE_SAMPLES:
        baseline_pool = [sample["latency_ms"] for sample in recent]

    baseline_ms = round(median(baseline_pool), 1) if baseline_pool else None

    spike_threshold_ms = None
    spikes: list[dict] = []
    if baseline_ms is not None:
        spike_threshold_ms = round(
            max(baseline_ms * SPIKE_FACTOR, baseline_ms + SPIKE_MIN_DELTA_MS), 1
        )
        spikes = [
            {"ts": sample["ts"], "latency_ms": sample["latency_ms"]}
            for sample in recent
            if sample["latency_ms"] >= spike_threshold_ms
        ]

    window_minutes = window_seconds / 60.0
    spike_rate_per_min = round(len(spikes) / window_minutes, 2) if window_minutes else 0.0
    worst_spike = max(spikes, key=lambda spike: spike["latency_ms"]) if spikes else None

    return {
        "baseline_ms": baseline_ms,
        "spike_threshold_ms": spike_threshold_ms,
        "spike_count": len(spikes),
        "spike_rate_per_min": spike_rate_per_min,
        "worst_spike": worst_spike,
    }


def _build_indicators(now_stats: dict, flow: dict) -> dict[str, dict]:
    indicators: dict[str, dict] = {}

    baseline_ms = flow.get("baseline_ms")
    ping_value = baseline_ms if baseline_ms is not None else now_stats.get("avg_ms")
    if ping_value is not None:
        level = _rate_scale(ping_value, GAMING_PING_GREAT, GAMING_PING_GOOD, GAMING_PING_OKAY)
        indicators["ping"] = {
            "level": level,
            "value": round(ping_value, 1),
            "text": f"baseline {ping_value:.0f} ms",
            "meaning": _INDICATOR_MEANINGS["ping"][level],
        }

    jitter_ms = now_stats.get("jitter_ms")
    if jitter_ms is not None:
        level = _rate_scale(jitter_ms, GAMING_JITTER_GREAT, GAMING_JITTER_GOOD, GAMING_JITTER_OKAY)
        indicators["jitter"] = {
            "level": level,
            "value": jitter_ms,
            "text": f"jitter {jitter_ms:.1f} ms",
            "meaning": _INDICATOR_MEANINGS["jitter"][level],
        }

    loss_pct = now_stats.get("loss_pct", 0.0)
    loss_level = rate_loss_pct(loss_pct)
    indicators["loss"] = {
        "level": loss_level,
        "value": loss_pct,
        "text": f"loss {loss_pct:.1f}%",
        "meaning": _INDICATOR_MEANINGS["loss"][loss_level],
    }

    spike_rate = flow.get("spike_rate_per_min") or 0.0
    spike_count = flow.get("spike_count", 0)
    spike_level = rate_spike_rate(spike_rate)
    worst_spike = flow.get("worst_spike")
    if spike_count and worst_spike is not None:
        plural = "s" if spike_count != 1 else ""
        spike_text = f"{spike_count} spike{plural} (worst {worst_spike['latency_ms']:.0f} ms)"
    else:
        spike_text = "no spikes"
    indicators["spikes"] = {
        "level": spike_level,
        "value": spike_rate,
        "count": spike_count,
        "worst_ms": worst_spike["latency_ms"] if worst_spike else None,
        "text": spike_text,
        "meaning": _INDICATOR_MEANINGS["spikes"][spike_level],
    }

    return indicators


def _offline_verdict(
    now_stats: dict,
    ratings: dict[str, str],
    indicators: dict[str, dict],
) -> dict | None:
    seconds_since_success = now_stats.get("seconds_since_success")
    offline = (
        now_stats.get("tail_failures", 0) >= NOW_OFFLINE_TAIL_FAILURES
        or seconds_since_success is None
        or seconds_since_success >= NOW_STALE_SUCCESS_SECONDS
    )
    if not offline:
        return None

    tail_failures = now_stats.get("tail_failures", 0)
    if tail_failures >= NOW_OFFLINE_TAIL_FAILURES:
        reasons = [f"{tail_failures} pings failed in a row"]
    elif seconds_since_success is None:
        reasons = ["no successful ping in the recent window"]
    else:
        reasons = [f"no successful ping for {seconds_since_success:.0f}s"]
    return {
        "level": "offline",
        "label": _GAMING_LABELS["offline"],
        "reasons": reasons,
        "ratings": ratings,
        "indicators": indicators,
    }


def compute_instant_verdict(now_stats: dict, flow: dict) -> dict:
    """Worst-of verdict across baseline ping / jitter / loss / spike rate.

    This is the raw, per-poll verdict; the displayed verdict goes through
    VerdictStabilizer so it doesn't flap on single pings.
    """
    if not now_stats.get("sample_count"):
        return {
            "level": "no_data",
            "label": _GAMING_LABELS["no_data"],
            "reasons": [],
            "ratings": {},
            "indicators": {},
        }

    indicators = _build_indicators(now_stats, flow)
    ratings = {key: indicator["level"] for key, indicator in indicators.items()}

    offline = _offline_verdict(now_stats, ratings, indicators)
    if offline is not None:
        return offline

    worst = "great"
    for level in ratings.values():
        if _GAMING_RANK[level] > _GAMING_RANK[worst]:
            worst = level

    reasons = [
        indicator["text"]
        for indicator in indicators.values()
        if indicator["level"] == worst and worst != "great"
    ]

    return {
        "level": worst,
        "label": _GAMING_LABELS[worst],
        "reasons": reasons,
        "ratings": ratings,
        "indicators": indicators,
    }


_DISPLAY_RANK = {"great": 0, "good": 1, "okay": 2, "bad": 3, "offline": 4}


class VerdictStabilizer:
    """Dwell-time hysteresis so the displayed verdict doesn't flap.

    Downgrades commit only after the worse condition holds for
    DOWNGRADE_DWELL_SECONDS; upgrades need UPGRADE_DWELL_SECONDS of sustained
    better readings. Offline commits immediately because it is already
    debounced upstream (NOW_OFFLINE_TAIL_FAILURES consecutive failures).
    """

    def __init__(
        self,
        *,
        downgrade_dwell_seconds: float = DOWNGRADE_DWELL_SECONDS,
        upgrade_dwell_seconds: float = UPGRADE_DWELL_SECONDS,
    ) -> None:
        self._downgrade_dwell = downgrade_dwell_seconds
        self._upgrade_dwell = upgrade_dwell_seconds
        self._level: str | None = None
        self._level_since: datetime | None = None
        self._worse_since: datetime | None = None
        self._better_since: datetime | None = None
        self._lock = threading.Lock()

    def update(self, instant_level: str, *, now: datetime | None = None) -> dict:
        now_dt = now or datetime.now(timezone.utc)
        with self._lock:
            self._advance(instant_level, now_dt)
            return self._snapshot(instant_level, now_dt)

    def _commit(self, level: str, now_dt: datetime) -> None:
        self._level = level
        self._level_since = now_dt
        self._worse_since = None
        self._better_since = None

    def _advance(self, instant: str, now_dt: datetime) -> None:
        if self._level is None or instant == "no_data" or self._level == "no_data":
            if instant != self._level:
                self._commit(instant, now_dt)
            return

        if instant == self._level:
            self._worse_since = None
            self._better_since = None
            return

        if _DISPLAY_RANK[instant] > _DISPLAY_RANK[self._level]:
            self._better_since = None
            if instant == "offline":
                self._commit(instant, now_dt)
                return
            if self._worse_since is None:
                self._worse_since = now_dt
            if (now_dt - self._worse_since).total_seconds() >= self._downgrade_dwell:
                self._commit(instant, now_dt)
        else:
            self._worse_since = None
            if self._better_since is None:
                self._better_since = now_dt
            if (now_dt - self._better_since).total_seconds() >= self._upgrade_dwell:
                self._commit(instant, now_dt)

    def _snapshot(self, instant: str, now_dt: datetime) -> dict:
        level = self._level or "no_data"
        since_seconds = (
            (now_dt - self._level_since).total_seconds() if self._level_since else 0.0
        )

        pending = None
        if self._worse_since is not None:
            pending = {
                "direction": "down",
                "level": instant,
                "for_seconds": round((now_dt - self._worse_since).total_seconds(), 1),
                "needed_seconds": self._downgrade_dwell,
            }
        elif self._better_since is not None:
            pending = {
                "direction": "up",
                "level": instant,
                "for_seconds": round((now_dt - self._better_since).total_seconds(), 1),
                "needed_seconds": self._upgrade_dwell,
            }

        return {
            "level": level,
            "label": _GAMING_LABELS.get(level, level),
            "since_seconds": round(since_seconds, 1),
            "pending": pending,
        }


def compute_health(stats: dict) -> dict:
    if stats.get("sample_count", 0) == 0:
        return {"level": "no_data", "label": _HEALTH_LABELS["no_data"], "reasons": []}

    packet_loss_pct = stats.get("packet_loss_pct", 0.0)
    if packet_loss_pct >= 50:
        return {
            "level": "offline",
            "label": _HEALTH_LABELS["offline"],
            "reasons": [f"packet loss {packet_loss_pct:.1f}%"],
        }

    evaluations: list[tuple[str, str | None]] = [
        _loss_severity(packet_loss_pct),
    ]

    latency_avg_ms = stats.get("latency_avg_ms")
    if latency_avg_ms is not None:
        evaluations.append(_latency_severity(latency_avg_ms))

    jitter_avg_ms = stats.get("jitter_avg_ms")
    if jitter_avg_ms is not None:
        evaluations.append(_jitter_severity(jitter_avg_ms))

    worst_level = "healthy"
    reasons: list[str] = []
    for level, reason in evaluations:
        if _SEVERITY_RANK[level] > _SEVERITY_RANK[worst_level]:
            worst_level = level
            reasons = [reason] if reason else []
        elif level == worst_level and reason:
            reasons.append(reason)

    return {
        "level": worst_level,
        "label": _HEALTH_LABELS[worst_level],
        "reasons": reasons,
    }
