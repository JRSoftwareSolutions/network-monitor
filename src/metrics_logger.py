import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.metrics_time import parse_ts
from src.sample_utils import parse_jsonl_sample


def _parse_log_line(line: str) -> tuple[datetime, str] | None:
    sample = parse_jsonl_sample(line)
    if sample is None:
        return None
    return parse_ts(sample["ts"]), line.strip()


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

        temp_path = self.log_file.with_suffix(self.log_file.suffix + ".tmp")
        try:
            with temp_path.open("w", encoding="utf-8") as handle:
                handle.write("".join(line + "\n" for _, line in kept))
            os.replace(temp_path, self.log_file)
        finally:
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)

    def _write_archive(self, lines: list[str]) -> None:
        # One archive file per UTC day (append) instead of one per pass.
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        archive_path = self.archive_dir / f"metrics-{day}.jsonl"
        with archive_path.open("a", encoding="utf-8") as handle:
            handle.write("".join(line + "\n" for line in lines))
