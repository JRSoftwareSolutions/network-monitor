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
