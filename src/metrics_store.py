import json
import threading
import time
from bisect import bisect_left
from collections import deque
from datetime import datetime, timedelta, timezone
from itertools import islice
from pathlib import Path

from src.metrics_time import _parse_ts, clamp_window_minutes


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
    """Thread-safe in-memory ring buffer of ping samples.

    A parallel deque of epoch floats mirrors the samples so trimming and
    window slicing compare floats (and bisect) instead of parsing ISO
    timestamps per sample.
    """

    def __init__(self, max_age_minutes: int) -> None:
        self._max_age_minutes = max_age_minutes
        self._samples: deque[dict] = deque()
        self._epochs: deque[float] = deque()
        self._lock = threading.Lock()

    def set_max_age_minutes(self, max_age_minutes: int) -> None:
        with self._lock:
            self._max_age_minutes = max_age_minutes
            self._trim_locked()

    def append(self, sample: dict) -> None:
        epoch = _parse_ts(sample["ts"]).timestamp()
        with self._lock:
            self._samples.append(sample)
            self._epochs.append(epoch)
            self._trim_locked()

    def _trim_locked(self) -> None:
        cutoff = time.time() - self._max_age_minutes * 60
        while self._epochs and self._epochs[0] < cutoff:
            self._epochs.popleft()
            self._samples.popleft()

    def get_window(self, window_minutes: int) -> list[dict]:
        window_minutes = clamp_window_minutes(window_minutes)
        cutoff = time.time() - window_minutes * 60
        with self._lock:
            self._trim_locked()
            start = bisect_left(self._epochs, cutoff)
            if start <= 0:
                return list(self._samples)
            return list(islice(self._samples, start, None))

    def latest(self) -> dict | None:
        with self._lock:
            return self._samples[-1] if self._samples else None

    def get_recent(self, count: int = 60) -> list[dict]:
        with self._lock:
            self._trim_locked()
            if count <= 0:
                return []
            total = len(self._samples)
            if count >= total:
                return list(self._samples)
            return list(islice(self._samples, total - count, None))


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


LOG_MAINTENANCE_INTERVAL_SECONDS = 60.0
LOG_FLUSH_INTERVAL_SECONDS = 5.0
LOG_FLUSH_MAX_LINES = 10
# Rewrites only happen once the log overshoots its limits by this much slack,
# so the file is rewritten every ~10+ minutes instead of every minute.
LOG_MAINTENANCE_SIZE_SLACK = 1.25
LOG_MAINTENANCE_AGE_SLACK_MINUTES = 10.0


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
        self._buffer: list[str] = []
        self._file_handle = None
        self._last_flush = time.monotonic()
        self._stop_event = threading.Event()
        self.log_file.parent.mkdir(parents=True, exist_ok=True)
        self._maintenance_thread = threading.Thread(
            target=self._maintenance_loop,
            daemon=True,
            name="MetricsLogMaintenance",
        )
        self._maintenance_thread.start()

    def append(self, sample: dict) -> None:
        line = json.dumps(sample, separators=(",", ":"))
        with self._lock:
            self._buffer.append(line)
            self._maybe_flush_locked()

    def flush(self) -> None:
        with self._lock:
            self._flush_buffer_locked()

    def close(self) -> None:
        self._stop_event.set()
        if self._maintenance_thread.is_alive():
            self._maintenance_thread.join(timeout=LOG_MAINTENANCE_INTERVAL_SECONDS + 2)
        with self._lock:
            self._flush_buffer_locked()
            self._close_handle_locked()

    def _maintenance_loop(self) -> None:
        while not self._stop_event.wait(LOG_MAINTENANCE_INTERVAL_SECONDS):
            self._maintain_log()

    def _ensure_handle_locked(self) -> None:
        if self._file_handle is None or self._file_handle.closed:
            self._file_handle = self.log_file.open("a", encoding="utf-8", buffering=8192)

    def _close_handle_locked(self) -> None:
        if self._file_handle is not None and not self._file_handle.closed:
            self._file_handle.close()
        self._file_handle = None

    def _flush_buffer_locked(self) -> None:
        if not self._buffer:
            return
        self._ensure_handle_locked()
        self._file_handle.write("\n".join(self._buffer) + "\n")
        self._file_handle.flush()
        self._buffer.clear()
        self._last_flush = time.monotonic()

    def _maybe_flush_locked(self) -> None:
        if len(self._buffer) >= LOG_FLUSH_MAX_LINES:
            self._flush_buffer_locked()
            return
        if time.monotonic() - self._last_flush >= LOG_FLUSH_INTERVAL_SECONDS:
            self._flush_buffer_locked()

    def _maintain_log(self) -> None:
        with self._lock:
            self._flush_buffer_locked()

        if not self._needs_maintenance():
            return

        with self._lock:
            self._flush_buffer_locked()
            self._close_handle_locked()
            self._rewrite_log_locked()

    def _needs_maintenance(self) -> bool:
        """Cheap pre-check (stat + first line) so the log is not re-read and
        rewritten every minute."""
        try:
            size = self.log_file.stat().st_size
        except OSError:
            return False
        if size == 0:
            return False
        if size > self.max_log_size_bytes * LOG_MAINTENANCE_SIZE_SLACK:
            return True

        oldest_ts = self._oldest_log_ts()
        if oldest_ts is None:
            return False
        age_cutoff = datetime.now(timezone.utc) - timedelta(
            minutes=self.max_log_age_minutes + LOG_MAINTENANCE_AGE_SLACK_MINUTES
        )
        return oldest_ts < age_cutoff

    def _oldest_log_ts(self) -> datetime | None:
        try:
            with self.log_file.open("r", encoding="utf-8") as handle:
                for line in handle:
                    entry = _parse_log_line(line)
                    if entry is not None:
                        return entry[0]
        except OSError:
            return None
        return None

    def _rewrite_log_locked(self) -> None:
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

        total_size = _lines_byte_size(line for _, line in kept)
        drop = 0
        while drop < len(kept) and total_size > self.max_log_size_bytes:
            total_size -= len(kept[drop][1]) + 1
            drop += 1
        if drop:
            archived.extend(line for _, line in kept[:drop])
            kept = kept[drop:]

        if not archived:
            return

        if self.archive_enabled:
            self._write_archive(archived)

        with self.log_file.open("w", encoding="utf-8") as handle:
            handle.write("".join(line + "\n" for _, line in kept))

    def _write_archive(self, lines: list[str]) -> None:
        # One archive file per UTC day (append) instead of one per pass.
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        archive_path = self.archive_dir / f"metrics-{day}.jsonl"
        with archive_path.open("a", encoding="utf-8") as handle:
            handle.write("".join(line + "\n" for line in lines))

