import threading


class MetricsPayloadCache:
    """Reuse computed full metrics payloads until a new ping sample or window change."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entry: tuple[str | None, int, dict] | None = None

    def get(self, window_minutes: int, latest_ts: str | None, builder) -> dict:
        with self._lock:
            if (
                self._entry
                and self._entry[0] == latest_ts
                and self._entry[1] == window_minutes
            ):
                return self._entry[2]
            payload = builder()
            self._entry = (latest_ts, window_minutes, payload)
            return payload
