import json
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path


class JitterTracker:
    """RFC 3550-style smoothed inter-arrival jitter."""

    def __init__(self) -> None:
        self._previous_rtt: float | None = None
        self._jitter: float | None = None

    def reset(self) -> None:
        self._previous_rtt = None
        self._jitter = None

    def update(self, rtt_ms: float) -> float | None:
        if self._previous_rtt is None:
            self._previous_rtt = rtt_ms
            return None

        delta = abs(rtt_ms - self._previous_rtt)
        if self._jitter is None:
            self._jitter = delta
        else:
            self._jitter += (delta - self._jitter) / 16.0

        self._previous_rtt = rtt_ms
        return round(self._jitter, 2)

    @property
    def value(self) -> float | None:
        return self._jitter


class SampleStore:
    """Thread-safe in-memory ring buffer of ping samples."""

    def __init__(self, max_age_minutes: int) -> None:
        self._max_age_minutes = max_age_minutes
        self._samples: deque[dict] = deque()
        self._lock = threading.Lock()

    def append(self, sample: dict) -> None:
        with self._lock:
            self._samples.append(sample)
            self._trim_locked()

    def _trim_locked(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=self._max_age_minutes)
        while self._samples:
            ts = _parse_ts(self._samples[0]["ts"])
            if ts < cutoff:
                self._samples.popleft()
            else:
                break

    def get_window(self, window_minutes: int) -> list[dict]:
        window_minutes = clamp_window_minutes(window_minutes)
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
        with self._lock:
            self._trim_locked()
            return [sample for sample in self._samples if _parse_ts(sample["ts"]) >= cutoff]

    def latest(self) -> dict | None:
        with self._lock:
            return self._samples[-1] if self._samples else None


LOG_MAINTENANCE_INTERVAL_SECONDS = 60.0


class MetricsLogger:
    def __init__(
        self,
        log_file: Path,
        max_log_age_minutes: int,
        *,
        archive_enabled: bool = True,
        max_log_size_bytes: int = 1024 * 1024,
        archive_dir: Path | None = None,
    ) -> None:
        self.log_file = log_file
        self.max_log_age_minutes = max_log_age_minutes
        self.archive_enabled = archive_enabled
        self.max_log_size_bytes = max_log_size_bytes
        self.archive_dir = archive_dir or (log_file.parent / "archive")
        self._lock = threading.Lock()
        self._last_maintenance = 0.0
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def append(self, sample: dict) -> None:
        line = json.dumps(sample, separators=(",", ":"))
        with self._lock:
            with self.log_file.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
                handle.flush()
            now = time.monotonic()
            if now - self._last_maintenance >= LOG_MAINTENANCE_INTERVAL_SECONDS:
                self._maintain_log()
                self._last_maintenance = now

    def _maintain_log(self) -> None:
        if not self.log_file.exists():
            return

        parsed_lines = _read_parsed_lines(self.log_file)
        if not parsed_lines:
            return

        age_cutoff = datetime.now(timezone.utc) - timedelta(minutes=self.max_log_age_minutes)
        kept: list[tuple[datetime, str]] = []
        archived: list[str] = []

        for ts, line in parsed_lines:
            if ts < age_cutoff:
                archived.append(line)
            else:
                kept.append((ts, line))

        while kept and _lines_byte_size(line for _, line in kept) > self.max_log_size_bytes:
            _, line = kept.pop(0)
            archived.append(line)

        if not archived:
            return

        if self.archive_enabled:
            self._write_archive(archived)

        with self.log_file.open("w", encoding="utf-8") as handle:
            for _, line in kept:
                handle.write(line + "\n")

    def _write_archive(self, lines: list[str]) -> None:
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        timestamp = (
            datetime.now(timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
            .replace(":", "-")
        )
        archive_path = self.archive_dir / f"metrics-{timestamp}.jsonl"
        with archive_path.open("a", encoding="utf-8") as handle:
            for line in lines:
                handle.write(line + "\n")


def _parse_log_line(line: str) -> tuple[datetime, str] | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        sample = json.loads(stripped)
        ts = _parse_ts(sample["ts"])
    except (json.JSONDecodeError, KeyError, ValueError):
        return None
    return ts, stripped


def _read_parsed_lines(log_file: Path) -> list[tuple[datetime, str]]:
    parsed: list[tuple[datetime, str]] = []
    with log_file.open("r", encoding="utf-8") as handle:
        for line in handle:
            entry = _parse_log_line(line)
            if entry is not None:
                parsed.append(entry)
    return parsed


def _lines_byte_size(lines) -> int:
    return sum(len(line) + 1 for line in lines)


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def clamp_window_minutes(window_minutes: int) -> int:
    return max(1, min(1440, window_minutes))


WINDOW_OPTIONS = [5, 15, 30, 60, 120]


def compute_window_options(max_log_age_minutes: int) -> list[int]:
    return [option for option in WINDOW_OPTIONS if option <= max_log_age_minutes]


def read_latest_sample(log_file: Path) -> dict | None:
    if not log_file.exists():
        return None

    try:
        size = log_file.stat().st_size
    except OSError:
        return None

    if size == 0:
        return None

    chunk_size = 4096
    with log_file.open("rb") as handle:
        offset = max(0, size - chunk_size)
        handle.seek(offset)
        chunk = handle.read().decode("utf-8", errors="replace")

    lines = [line.strip() for line in chunk.splitlines() if line.strip()]
    if not lines:
        return None

    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return None


def read_samples(log_file: Path, window_minutes: int) -> list[dict]:
    if not log_file.exists():
        return []

    window_minutes = clamp_window_minutes(window_minutes)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    samples: list[dict] = []

    with log_file.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                sample = json.loads(stripped)
                ts = _parse_ts(sample["ts"])
            except (json.JSONDecodeError, KeyError, ValueError):
                continue
            if ts >= cutoff:
                samples.append(sample)

    return samples


BLOCKS_BUCKET_SECONDS = 60
MAX_CHART_SAMPLES = 1500


def _format_ts(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _floor_to_bucket(ts: datetime, bucket_seconds: int) -> datetime:
    epoch = int(ts.timestamp())
    bucket_start = (epoch // bucket_seconds) * bucket_seconds
    return datetime.fromtimestamp(bucket_start, tz=timezone.utc)


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        raise ValueError("empty values")
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, int((pct / 100) * len(sorted_values) + 0.999999) - 1)
    index = max(0, index)
    return sorted_values[index]


def _median(values: list[float]) -> float:
    if not values:
        raise ValueError("empty values")
    sorted_values = sorted(values)
    count = len(sorted_values)
    mid = count // 2
    if count % 2:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2


def downsample_samples(
    samples: list[dict],
    max_points: int = MAX_CHART_SAMPLES,
    *,
    window_minutes: int | None = None,
    window_end: datetime | None = None,
) -> list[dict]:
    if not samples:
        return []
    if len(samples) <= max_points:
        return samples

    end = window_end or datetime.now(timezone.utc)

    if window_minutes is not None:
        window_minutes = clamp_window_minutes(window_minutes)
        span_seconds = window_minutes * 60
    else:
        first_ts = _parse_ts(samples[0]["ts"])
        last_ts = _parse_ts(samples[-1]["ts"])
        span_seconds = max(1, int((last_ts - first_ts).total_seconds()) + 1)

    bucket_seconds = max(1, -(-span_seconds // max_points))

    grouped: dict[datetime, list[dict]] = {}
    for sample in samples:
        bucket_start = _floor_to_bucket(_parse_ts(sample["ts"]), bucket_seconds)
        grouped.setdefault(bucket_start, []).append(sample)

    if window_minutes is not None:
        num_buckets = max(1, -(-span_seconds // bucket_seconds))
        current_bucket = _floor_to_bucket(end, bucket_seconds)
        bucket_starts = [
            current_bucket - timedelta(seconds=bucket_seconds * offset)
            for offset in range(num_buckets - 1, -1, -1)
        ]
    else:
        first_ts = _parse_ts(samples[0]["ts"])
        last_ts = _parse_ts(samples[-1]["ts"])
        first_bucket = _floor_to_bucket(first_ts, bucket_seconds)
        last_bucket = _floor_to_bucket(last_ts, bucket_seconds)
        bucket_starts = []
        current = first_bucket
        while current <= last_bucket:
            bucket_starts.append(current)
            current += timedelta(seconds=bucket_seconds)

    downsampled: list[dict] = []
    cumulative_failed = 0
    cumulative_total = 0
    for current in bucket_starts:
        chunk = grouped.get(current, [])
        if chunk:
            cumulative_total += len(chunk)
            cumulative_failed += sum(1 for sample in chunk if not sample.get("success"))
            rolling_loss_pct = (
                round((cumulative_failed / cumulative_total) * 100, 2) if cumulative_total else 0.0
            )

            successes = [sample for sample in chunk if sample.get("success")]
            if successes:
                avg_latency = sum(sample["latency_ms"] for sample in successes) / len(successes)
                last_jitter = next(
                    (
                        sample["jitter_ms"]
                        for sample in reversed(successes)
                        if sample.get("jitter_ms") is not None
                    ),
                    None,
                )
                downsampled.append(
                    {
                        "ts": _format_ts(current),
                        "host": chunk[0].get("host"),
                        "success": True,
                        "latency_ms": round(avg_latency, 2),
                        "jitter_ms": round(last_jitter, 2) if last_jitter is not None else None,
                        "rolling_loss_pct": rolling_loss_pct,
                    }
                )
            else:
                downsampled.append(
                    {
                        "ts": _format_ts(current),
                        "host": chunk[0].get("host"),
                        "success": False,
                        "latency_ms": None,
                        "jitter_ms": None,
                        "rolling_loss_pct": rolling_loss_pct,
                    }
                )

    return downsampled


def _summarize_bucket(bucket_samples_list: list[dict]) -> dict:
    latencies = [
        sample["latency_ms"]
        for sample in bucket_samples_list
        if sample.get("success") and sample.get("latency_ms") is not None
    ]
    jitters = [
        sample["jitter_ms"]
        for sample in bucket_samples_list
        if sample.get("jitter_ms") is not None
    ]
    total = len(bucket_samples_list)
    failed = sum(1 for sample in bucket_samples_list if not sample.get("success"))

    bucket: dict = {
        "sample_count": total,
        "failed_count": failed,
        "loss_pct": round((failed / total) * 100, 2) if total else 0.0,
        "open_ms": None,
        "high_ms": None,
        "low_ms": None,
        "close_ms": None,
        "avg_ms": None,
        "jitter_avg_ms": None,
    }

    if latencies:
        bucket.update(
            {
                "open_ms": round(latencies[0], 2),
                "high_ms": round(max(latencies), 2),
                "low_ms": round(min(latencies), 2),
                "close_ms": round(latencies[-1], 2),
                "avg_ms": round(sum(latencies) / len(latencies), 2),
                "jitter_avg_ms": round(sum(jitters) / len(jitters), 2) if jitters else None,
            }
        )

    return bucket


def bucket_samples(
    samples: list[dict],
    bucket_seconds: int = BLOCKS_BUCKET_SECONDS,
    *,
    window_minutes: int | None = None,
    window_end: datetime | None = None,
) -> list[dict]:
    bucket_seconds = max(1, int(bucket_seconds))
    end = window_end or datetime.now(timezone.utc)

    grouped: dict[datetime, list[dict]] = {}
    for sample in samples:
        ts = _parse_ts(sample["ts"])
        bucket_start = _floor_to_bucket(ts, bucket_seconds)
        grouped.setdefault(bucket_start, []).append(sample)

    if window_minutes is not None:
        window_minutes = clamp_window_minutes(window_minutes)
        num_buckets = max(1, (window_minutes * 60) // bucket_seconds)
        current_bucket = _floor_to_bucket(end, bucket_seconds)
        bucket_starts = [
            current_bucket - timedelta(seconds=bucket_seconds * offset)
            for offset in range(num_buckets - 1, -1, -1)
        ]
    else:
        bucket_starts = sorted(grouped.keys())

    buckets: list[dict] = []
    for bucket_start in bucket_starts:
        bucket_end = bucket_start + timedelta(seconds=bucket_seconds)
        summary = _summarize_bucket(grouped.get(bucket_start, []))
        buckets.append(
            {
                "ts_start": _format_ts(bucket_start),
                "ts_end": _format_ts(bucket_end),
                **summary,
            }
        )

    return buckets


def compute_stats(samples: list[dict]) -> dict:
    if not samples:
        return {
            "packet_loss_pct": 0.0,
            "uptime_pct": 100.0,
            "latency_avg_ms": None,
            "latency_min_ms": None,
            "latency_max_ms": None,
            "latency_p95_ms": None,
            "jitter_avg_ms": None,
            "sample_count": 0,
        }

    total = len(samples)
    failed = sum(1 for sample in samples if not sample.get("success"))
    latencies = [
        sample["latency_ms"]
        for sample in samples
        if sample.get("success") and sample.get("latency_ms") is not None
    ]
    jitters = [sample["jitter_ms"] for sample in samples if sample.get("jitter_ms") is not None]
    loss_pct = round((failed / total) * 100, 2) if total else 0.0

    return {
        "packet_loss_pct": loss_pct,
        "uptime_pct": round(100.0 - loss_pct, 2),
        "latency_avg_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
        "latency_min_ms": round(min(latencies), 2) if latencies else None,
        "latency_max_ms": round(max(latencies), 2) if latencies else None,
        "latency_p95_ms": round(_percentile(latencies, 95), 2) if latencies else None,
        "jitter_avg_ms": round(sum(jitters) / len(jitters), 2) if jitters else None,
        "sample_count": total,
    }


def detect_outages(samples: list[dict]) -> list[dict]:
    if not samples:
        return []

    outages: list[dict] = []
    outage_start: str | None = None
    outage_count = 0

    for sample in samples:
        if not sample.get("success"):
            if outage_start is None:
                outage_start = sample["ts"]
            outage_count += 1
            continue

        if outage_start is not None:
            outages.append(
                _build_outage(outage_start, sample["ts"], outage_count, ongoing=False)
            )
            outage_start = None
            outage_count = 0

    if outage_start is not None:
        outages.append(
            _build_outage(outage_start, samples[-1]["ts"], outage_count, ongoing=True)
        )

    return list(reversed(outages))


def _build_outage(start_ts: str, end_ts: str, failed_count: int, *, ongoing: bool) -> dict:
    start = _parse_ts(start_ts)
    end = _parse_ts(end_ts)
    duration_seconds = max(0, int((end - start).total_seconds()))

    return {
        "start_ts": start_ts,
        "end_ts": None if ongoing else end_ts,
        "duration_seconds": duration_seconds,
        "failed_count": failed_count,
        "ongoing": ongoing,
    }


_HEALTH_LABELS = {
    "healthy": "Healthy",
    "degraded": "Degraded",
    "poor": "Poor",
    "offline": "Offline",
    "no_data": "No data",
}
_SEVERITY_RANK = {"healthy": 0, "degraded": 1, "poor": 2, "offline": 3}


def _loss_severity(packet_loss_pct: float) -> tuple[str, str | None]:
    if packet_loss_pct >= 50:
        return "offline", f"packet loss {packet_loss_pct:.1f}%"
    if packet_loss_pct >= 10:
        return "poor", f"packet loss {packet_loss_pct:.1f}%"
    if packet_loss_pct >= 1:
        return "degraded", f"packet loss {packet_loss_pct:.1f}%"
    return "healthy", None


def _latency_severity(latency_avg_ms: float) -> tuple[str, str | None]:
    if latency_avg_ms >= 200:
        return "poor", f"avg latency {latency_avg_ms:.1f} ms"
    if latency_avg_ms >= 80:
        return "degraded", f"avg latency {latency_avg_ms:.1f} ms"
    return "healthy", None


def _jitter_severity(jitter_avg_ms: float) -> tuple[str, str | None]:
    if jitter_avg_ms >= 50:
        return "poor", f"avg jitter {jitter_avg_ms:.1f} ms"
    if jitter_avg_ms >= 20:
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
TREND_RECENT_SECONDS = 120
TREND_PRIOR_SECONDS = 600
TREND_MIN_SAMPLES = 12
TREND_LATENCY_DELTA_MS = 5.0
TREND_LATENCY_DELTA_RATIO = 0.15
TREND_LOSS_DELTA_PCT = 1.0

_GAMING_LABELS = {
    "great": "Great for gaming",
    "good": "Good to game",
    "okay": "Playable, expect hiccups",
    "bad": "Rough — expect lag",
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
    """Stats over the trailing `window_seconds` — the 'can I game right now?' window."""
    now_dt = now or datetime.now(timezone.utc)
    cutoff = now_dt - timedelta(seconds=window_seconds)
    recent = [sample for sample in samples if _parse_ts(sample["ts"]) >= cutoff]

    total = len(recent)
    failed = sum(1 for sample in recent if not sample.get("success"))
    latencies = [
        sample["latency_ms"]
        for sample in recent
        if sample.get("success") and sample.get("latency_ms") is not None
    ]
    jitters = [sample["jitter_ms"] for sample in recent if sample.get("jitter_ms") is not None]

    tail_failures = 0
    for sample in reversed(recent):
        if sample.get("success"):
            break
        tail_failures += 1

    seconds_since_success: float | None = None
    for sample in reversed(recent):
        if sample.get("success"):
            seconds_since_success = max(0.0, (now_dt - _parse_ts(sample["ts"])).total_seconds())
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


def _rate_loss_pct(loss_pct: float) -> str:
    if loss_pct <= 0:
        return "great"
    if loss_pct < 1:
        return "good"
    if loss_pct <= 3:
        return "okay"
    return "bad"


def _rate_spike_rate(rate_per_min: float) -> str:
    if rate_per_min <= 0:
        return "great"
    if rate_per_min < 1:
        return "good"
    if rate_per_min <= 4:
        return "okay"
    return "bad"


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
        for sample in samples
        if sample.get("success")
        and sample.get("latency_ms") is not None
        and _parse_ts(sample["ts"]) >= cutoff
    ]

    baseline_cutoff = now_dt - timedelta(seconds=baseline_seconds)
    baseline_pool = [
        sample["latency_ms"] for sample in recent if _parse_ts(sample["ts"]) >= baseline_cutoff
    ]
    if len(baseline_pool) < MIN_BASELINE_SAMPLES:
        baseline_pool = [sample["latency_ms"] for sample in recent]

    baseline_ms = round(_median(baseline_pool), 1) if baseline_pool else None

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

    p95_vs_baseline = None
    if baseline_ms and recent:
        p95 = _percentile([sample["latency_ms"] for sample in recent], 95)
        p95_vs_baseline = round(p95 / baseline_ms, 2)

    return {
        "baseline_ms": baseline_ms,
        "spike_threshold_ms": spike_threshold_ms,
        "spike_count": len(spikes),
        "spike_rate_per_min": spike_rate_per_min,
        "worst_spike": worst_spike,
        "spikes": spikes[-12:],
        "p95_vs_baseline": p95_vs_baseline,
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

    indicators: dict[str, dict] = {}

    baseline_ms = flow.get("baseline_ms")
    ping_value = baseline_ms if baseline_ms is not None else now_stats.get("avg_ms")
    if ping_value is not None:
        level = _rate_scale(ping_value, 40, 70, 110)
        indicators["ping"] = {
            "level": level,
            "value": round(ping_value, 1),
            "text": f"baseline {ping_value:.0f} ms",
            "meaning": _INDICATOR_MEANINGS["ping"][level],
        }

    jitter_ms = now_stats.get("jitter_ms")
    if jitter_ms is not None:
        level = _rate_scale(jitter_ms, 8, 15, 30)
        indicators["jitter"] = {
            "level": level,
            "value": jitter_ms,
            "text": f"jitter {jitter_ms:.1f} ms",
            "meaning": _INDICATOR_MEANINGS["jitter"][level],
        }

    loss_pct = now_stats.get("loss_pct", 0.0)
    loss_level = _rate_loss_pct(loss_pct)
    indicators["loss"] = {
        "level": loss_level,
        "value": loss_pct,
        "text": f"loss {loss_pct:.1f}%",
        "meaning": _INDICATOR_MEANINGS["loss"][loss_level],
    }

    spike_rate = flow.get("spike_rate_per_min") or 0.0
    spike_count = flow.get("spike_count", 0)
    spike_level = _rate_spike_rate(spike_rate)
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

    ratings = {key: indicator["level"] for key, indicator in indicators.items()}

    seconds_since_success = now_stats.get("seconds_since_success")
    offline = (
        now_stats.get("tail_failures", 0) >= NOW_OFFLINE_TAIL_FAILURES
        or seconds_since_success is None
        or seconds_since_success >= NOW_STALE_SUCCESS_SECONDS
    )
    if offline:
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
        ts = _parse_ts(sample["ts"])
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
    "degrading": "Conditions are worse than the previous 10 minutes — keep an eye on it.",
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
                "No pings recorded in the last 2 minutes — the monitor may still be warming up."
            ],
            "chips": [],
        }

    if level == "offline":
        tail_failures = now_stats.get("tail_failures", 0)
        seconds_since = now_stats.get("seconds_since_success")
        sentences = []
        if tail_failures >= NOW_OFFLINE_TAIL_FAILURES:
            sentences.append(
                f"Your connection looks down — the last {tail_failures} pings all failed."
            )
        else:
            sentences.append("Your connection looks down — nothing is getting through right now.")
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
        sentences.append(f"{opener} — {quality}.")

    spike_count = flow.get("spike_count", 0)
    worst_spike = flow.get("worst_spike")
    spike_rate = flow.get("spike_rate_per_min") or 0.0
    if not spike_count:
        sentences.append("No latency spikes in the last 2 minutes.")
    elif worst_spike is not None:
        worst_ms = worst_spike["latency_ms"]
        ago = _format_seconds_ago((now_dt - _parse_ts(worst_spike["ts"])).total_seconds())
        if spike_count == 1:
            sentences.append(
                f"One spike to {worst_ms:.0f} ms {ago} — an isolated blip like that is a "
                "single micro-hitch, not real lag."
            )
        elif _rate_spike_rate(spike_rate) in ("good", "okay"):
            sentences.append(
                f"{spike_count} spikes in the last 2 minutes (worst {worst_ms:.0f} ms, {ago}) "
                "— you may feel the occasional hitch."
            )
        else:
            sentences.append(
                f"{spike_count} spikes in the last 2 minutes — frequent enough to cause "
                "rubber-banding in game."
            )

    loss_pct = now_stats.get("loss_pct", 0.0)
    if loss_pct > 0:
        loss_level = _rate_loss_pct(loss_pct)
        if loss_level == "good":
            sentences.append(f"Packet loss is {loss_pct:.1f}% — negligible.")
        elif loss_level == "okay":
            sentences.append(
                f"Packet loss is {loss_pct:.1f}% — enough for the odd hiccup; an action may "
                "occasionally not register."
            )
        else:
            sentences.append(
                f"Packet loss is {loss_pct:.1f}% — this hurts gameplay more than raw ping; "
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
                f"Things look better than the verdict shows — confirming for another "
                f"{remaining:.0f}s before upgrading."
            )
        else:
            sentences.append(
                f"Watching a possible slowdown — the verdict drops in {remaining:.0f}s "
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
