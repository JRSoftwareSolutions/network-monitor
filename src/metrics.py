import json
import threading
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
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def append(self, sample: dict) -> None:
        line = json.dumps(sample, separators=(",", ":"))
        with self._lock:
            with self.log_file.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
                handle.flush()
            self._maintain_log()

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
        # when archive_enabled is false, archived lines are discarded

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
        ts = datetime.fromisoformat(sample["ts"].replace("Z", "+00:00"))
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


def clamp_window_minutes(window_minutes: int) -> int:
    return max(1, min(1440, window_minutes))


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
                ts = datetime.fromisoformat(sample["ts"].replace("Z", "+00:00"))
            except (json.JSONDecodeError, KeyError, ValueError):
                continue
            if ts >= cutoff:
                samples.append(sample)

    return samples


BLOCKS_WINDOW_MINUTES = 5
BLOCKS_BUCKET_SECONDS = 60


def _format_ts(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _floor_to_bucket(ts: datetime, bucket_seconds: int) -> datetime:
    epoch = int(ts.timestamp())
    bucket_start = (epoch // bucket_seconds) * bucket_seconds
    return datetime.fromtimestamp(bucket_start, tz=timezone.utc)


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
        ts = datetime.fromisoformat(sample["ts"].replace("Z", "+00:00"))
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
            "latency_avg_ms": None,
            "latency_min_ms": None,
            "latency_max_ms": None,
            "jitter_avg_ms": None,
            "sample_count": 0,
        }

    total = len(samples)
    failed = sum(1 for sample in samples if not sample.get("success"))
    latencies = [sample["latency_ms"] for sample in samples if sample.get("success") and sample.get("latency_ms") is not None]
    jitters = [sample["jitter_ms"] for sample in samples if sample.get("jitter_ms") is not None]

    return {
        "packet_loss_pct": round((failed / total) * 100, 2) if total else 0.0,
        "latency_avg_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
        "latency_min_ms": round(min(latencies), 2) if latencies else None,
        "latency_max_ms": round(max(latencies), 2) if latencies else None,
        "jitter_avg_ms": round(sum(jitters) / len(jitters), 2) if jitters else None,
        "sample_count": total,
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
