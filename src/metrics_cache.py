import threading


class MetricsCache:
    """Reuse computed API payloads until a new ping sample arrives."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[tuple[str, int], tuple[str | None, dict]] = {}

    def get(self, kind: str, window: int, latest_ts: str | None, builder) -> dict:
        key = (kind, window)
        if kind == "live":
            with self._lock:
                cached = self._entries.get(key)
                if cached and cached[0] == latest_ts:
                    return cached[1]

        payload = builder()
        if kind == "live":
            with self._lock:
                # `window` is user-controlled (1-1440); evict entries built for an
                # older sample so the cache stays bounded to the current payloads.
                stale_keys = [k for k, (ts, _) in self._entries.items() if ts != latest_ts]
                for stale_key in stale_keys:
                    del self._entries[stale_key]
                self._entries[key] = (latest_ts, payload)
        return payload
