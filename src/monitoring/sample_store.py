import threading
from bisect import bisect_left
from collections import deque
from itertools import islice

from src.metrics.time import clamp_window_minutes, parse_ts, sort_samples_by_ts, utc_now_ts


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
        epoch = parse_ts(sample["ts"]).timestamp()
        with self._lock:
            self._samples.append(sample)
            self._epochs.append(epoch)
            self._trim_locked()

    def _trim_locked(self) -> None:
        cutoff = utc_now_ts() - self._max_age_minutes * 60
        while self._epochs and self._epochs[0] < cutoff:
            self._epochs.popleft()
            self._samples.popleft()

    def get_window(self, window_minutes: int) -> list[dict]:
        window_minutes = clamp_window_minutes(window_minutes)
        cutoff = utc_now_ts() - window_minutes * 60
        with self._lock:
            self._trim_locked()
            start = bisect_left(self._epochs, cutoff)
            if start <= 0:
                return sort_samples_by_ts(list(self._samples))
            return sort_samples_by_ts(list(islice(self._samples, start, None)))

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
                return sort_samples_by_ts(list(self._samples))
            return sort_samples_by_ts(list(islice(self._samples, total - count, None)))

    def get_recent_seconds(self, seconds: int) -> list[dict]:
        if seconds <= 0:
            return []
        cutoff = utc_now_ts() - seconds
        with self._lock:
            self._trim_locked()
            if not self._epochs:
                return []
            start = bisect_left(self._epochs, cutoff)
            if start <= 0:
                return sort_samples_by_ts(list(self._samples))
            return sort_samples_by_ts(list(islice(self._samples, start, None)))
