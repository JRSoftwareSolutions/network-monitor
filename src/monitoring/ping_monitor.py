import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from src.metrics import JitterTracker, MetricsLogger, SampleStore, read_samples
from src.metrics.windows import RECENT_SAMPLES_SECONDS
from src.metrics.time import format_ts
from src.platform.win_proc import CREATE_NO_WINDOW, ping_startupinfo

# Locale-neutral: matches time=14ms, tijd=14 ms, temps=14,5ms, etc.
LATENCY_PATTERN = re.compile(r"[=<]\s*(\d+(?:[.,]\d+)?)\s*ms", re.IGNORECASE)
SUB_MILLIS_PATTERN = re.compile(r"[=<]\s*1\s*ms", re.IGNORECASE)

DNS_REFRESH_SECONDS = 300.0


def is_ipv6_target(target: str) -> bool:
    """True for IPv6 literals; native win_ping is IPv4-only."""
    return ":" in target


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


def run_ping_subprocess(target: str, timeout_ms: int = 1000) -> tuple[bool, float | None]:
    result = subprocess.run(
        ["ping", "-n", "1", "-w", str(timeout_ms), target],
        capture_output=True,
        text=True,
        encoding="cp437",
        errors="replace",
        startupinfo=ping_startupinfo(),
        creationflags=CREATE_NO_WINDOW,
    )
    output = result.stdout + result.stderr
    return parse_ping_output(output, result.returncode)


class PingBackend:
    """Native Windows ICMP when available; subprocess ping as fallback."""

    def __init__(self, target: str, timeout_ms: int = 1000) -> None:
        self.target = target
        self.timeout_ms = timeout_ms
        self._target_ip: int | None = None
        self._resolved_at = 0.0
        self._win_ping = None

        if sys.platform == "win32":
            try:
                from src.monitoring import win_ping

                self._win_ping = win_ping
            except OSError:
                self._win_ping = None
            self._resolve_now()

    def set_target(self, target: str) -> None:
        """Switch the ping destination; the next ping re-resolves it."""
        self.target = target
        self._target_ip = None
        self._resolved_at = 0.0

    def _resolve_now(self) -> None:
        if self._win_ping is None or is_ipv6_target(self.target):
            self._target_ip = None
            self._resolved_at = time.monotonic()
            return
        try:
            self._target_ip = self._win_ping.resolve_target(self.target)
        except OSError:
            # Unresolvable right now: keep the monitor alive, let the
            # subprocess fallback report failures, retry on the next ping.
            self._target_ip = None
        self._resolved_at = time.monotonic()

    def _ensure_ip(self) -> int | None:
        if self._win_ping is None:
            return None

        now = time.monotonic()
        if self._target_ip is None or now - self._resolved_at >= DNS_REFRESH_SECONDS:
            self._resolve_now()
        return self._target_ip

    def ping(self) -> tuple[bool, float | None]:
        if is_ipv6_target(self.target):
            return run_ping_subprocess(self.target, self.timeout_ms)
        if self._win_ping is not None:
            ip_addr = self._ensure_ip()
            if ip_addr is not None:
                try:
                    return self._win_ping.run_win_ping(ip_addr, self.timeout_ms)
                except OSError:
                    self._win_ping = None
        return run_ping_subprocess(self.target, self.timeout_ms)


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
        self._backend = PingBackend(target, ping_timeout_ms)
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

    def get_recent_samples(self, seconds: int = RECENT_SAMPLES_SECONDS) -> list[dict]:
        return self._store.get_recent_seconds(seconds)

    def apply_settings(
        self,
        *,
        target: str | None = None,
        interval_seconds: float | None = None,
        max_log_age_minutes: int | None = None,
    ) -> None:
        """Apply new settings to the running monitor without a restart.

        The ping loop reads `interval_seconds` each iteration, a changed
        target is re-resolved on the next ping, and retention updates reach
        both the in-memory store and the log maintenance thread.
        """
        if target is not None and target != self.target:
            self.target = target
            self._backend.set_target(target)
            # Jitter compares consecutive RTTs; a target switch would
            # otherwise register as one bogus spike.
            self._jitter.reset()
        if interval_seconds is not None:
            self.interval_seconds = interval_seconds
        if max_log_age_minutes is not None and max_log_age_minutes != self.max_log_age_minutes:
            self.max_log_age_minutes = max_log_age_minutes
            self._logger.max_log_age_minutes = max_log_age_minutes
            self._store.set_max_age_minutes(max_log_age_minutes)

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
        self._logger.flush()
        self._logger.close()
        if sys.platform == "win32":
            try:
                from src.monitoring import win_ping

                win_ping.close()
            except OSError:
                pass

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            started = time.monotonic()
            success, latency_ms = self._backend.ping()
            jitter_ms = self._jitter.update(latency_ms) if success else None
            if not success:
                self._jitter.reset()

            sample = {
                "ts": format_ts(datetime.now(timezone.utc)),
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
