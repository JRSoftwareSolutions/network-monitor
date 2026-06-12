import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from src.metrics import JitterTracker, MetricsLogger, SampleStore, read_samples

# Locale-neutral: matches time=14ms, tijd=14 ms, temps=14,5ms, etc.
LATENCY_PATTERN = re.compile(r"[=<]\s*(\d+(?:[.,]\d+)?)\s*ms", re.IGNORECASE)
SUB_MILLIS_PATTERN = re.compile(r"[=<]\s*1\s*ms", re.IGNORECASE)


def parse_ping_output(output: str, returncode: int = 0) -> tuple[bool, float | None]:
    if SUB_MILLIS_PATTERN.search(output):
        if returncode not in (0, 1):
            return False, None
        return True, 0.5

    match = LATENCY_PATTERN.search(output)
    if match:
        latency = float(match.group(1).replace(",", "."))
        if returncode not in (0, 1):
            return False, None
        return True, latency

    return False, None


def run_ping(target: str, timeout_ms: int = 1000) -> tuple[bool, float | None]:
    result = subprocess.run(
        ["ping", "-n", "1", "-w", str(timeout_ms), target],
        capture_output=True,
        text=True,
        encoding="cp437",
        errors="replace",
    )
    output = result.stdout + result.stderr
    return parse_ping_output(output, result.returncode)


class PingMonitor:
    def __init__(
        self,
        target: str,
        interval_seconds: float,
        log_file: Path,
        max_log_age_minutes: int,
        ping_timeout_ms: int = 1000,
        *,
        archive_enabled: bool = True,
        max_log_size_bytes: int = 1024 * 1024,
        archive_dir: Path | None = None,
    ) -> None:
        self.target = target
        self.interval_seconds = interval_seconds
        self.ping_timeout_ms = ping_timeout_ms
        self.max_log_age_minutes = max_log_age_minutes
        self._logger = MetricsLogger(
            log_file,
            max_log_age_minutes,
            archive_enabled=archive_enabled,
            max_log_size_bytes=max_log_size_bytes,
            archive_dir=archive_dir,
        )
        self._store = SampleStore(max_log_age_minutes)
        self._seed_from_log(log_file)
        self._jitter = JitterTracker()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def _seed_from_log(self, log_file: Path) -> None:
        samples = read_samples(log_file, self.max_log_age_minutes)
        for sample in samples:
            self._store.append(sample)

    def get_samples(self, window_minutes: int) -> list[dict]:
        return self._store.get_window(window_minutes)

    def get_latest_sample(self) -> dict | None:
        return self._store.latest()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="PingMonitor")
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=self.interval_seconds + self.ping_timeout_ms / 1000 + 2)

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            started = time.monotonic()
            success, latency_ms = run_ping(self.target, self.ping_timeout_ms)
            jitter_ms = self._jitter.update(latency_ms) if success else None
            if not success:
                self._jitter.reset()

            sample = {
                "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "host": self.target,
                "success": success,
                "latency_ms": latency_ms,
                "jitter_ms": jitter_ms,
            }
            self._store.append(sample)
            self._logger.append(sample)

            elapsed = time.monotonic() - started
            sleep_for = max(0.0, self.interval_seconds - elapsed)
            if self._stop_event.wait(sleep_for):
                break
