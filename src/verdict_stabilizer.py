import threading
from datetime import datetime, timezone

from src.verdict_gaming import (
    DISPLAY_RANK,
    DOWNGRADE_DWELL_SECONDS,
    UPGRADE_DWELL_SECONDS,
    gaming_label,
)


class VerdictStabilizer:
    """Dwell-time hysteresis so the displayed verdict doesn't flap."""

    def __init__(
        self,
        *,
        downgrade_dwell_seconds: float = DOWNGRADE_DWELL_SECONDS,
        upgrade_dwell_seconds: float = UPGRADE_DWELL_SECONDS,
    ) -> None:
        self._downgrade_dwell = downgrade_dwell_seconds
        self._upgrade_dwell = upgrade_dwell_seconds
        self._level: str | None = None
        self._level_since: datetime | None = None
        self._worse_since: datetime | None = None
        self._better_since: datetime | None = None
        self._lock = threading.Lock()

    def update(self, instant_level: str, *, now: datetime | None = None) -> dict:
        now_dt = now or datetime.now(timezone.utc)
        with self._lock:
            self._advance(instant_level, now_dt)
            return self._snapshot(instant_level, now_dt)

    def _commit(self, level: str, now_dt: datetime) -> None:
        self._level = level
        self._level_since = now_dt
        self._worse_since = None
        self._better_since = None

    def _advance(self, instant: str, now_dt: datetime) -> None:
        if self._level is None or instant == "no_data" or self._level == "no_data":
            if instant != self._level:
                self._commit(instant, now_dt)
            return

        if instant == self._level:
            self._worse_since = None
            self._better_since = None
            return

        if DISPLAY_RANK[instant] > DISPLAY_RANK[self._level]:
            self._better_since = None
            if instant == "offline":
                self._commit(instant, now_dt)
                return
            if self._worse_since is None:
                self._worse_since = now_dt
            if (now_dt - self._worse_since).total_seconds() >= self._downgrade_dwell:
                self._commit(instant, now_dt)
        else:
            self._worse_since = None
            if self._better_since is None:
                self._better_since = now_dt
            if (now_dt - self._better_since).total_seconds() >= self._upgrade_dwell:
                self._commit(instant, now_dt)

    def _snapshot(self, instant: str, now_dt: datetime) -> dict:
        level = self._level or "no_data"
        since_seconds = (
            (now_dt - self._level_since).total_seconds() if self._level_since else 0.0
        )

        pending = None
        if self._worse_since is not None:
            pending = {
                "direction": "down",
                "level": instant,
                "for_seconds": round((now_dt - self._worse_since).total_seconds(), 1),
                "needed_seconds": self._downgrade_dwell,
            }
        elif self._better_since is not None:
            pending = {
                "direction": "up",
                "level": instant,
                "for_seconds": round((now_dt - self._better_since).total_seconds(), 1),
                "needed_seconds": self._upgrade_dwell,
            }

        return {
            "level": level,
            "label": gaming_label(level),
            "since_seconds": round(since_seconds, 1),
            "pending": pending,
        }
