import threading


class MetricsCache:
    """Reuse computed live API payloads until a new ping sample arrives."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._live: tuple[str | None, dict] | None = None

    def get_live(self, latest_ts: str | None, builder) -> dict:
        with self._lock:
            if self._live and self._live[0] == latest_ts:
                return self._live[1]

        payload = builder()
        with self._lock:
            self._live = (latest_ts, payload)
        return payload
