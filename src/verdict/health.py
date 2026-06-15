from src.metrics.constants import (
    HEALTH_JITTER_DEGRADED,
    HEALTH_JITTER_POOR,
    HEALTH_LATENCY_DEGRADED,
    HEALTH_LATENCY_POOR,
    HEALTH_LOSS_DEGRADED,
    HEALTH_LOSS_OFFLINE,
    HEALTH_LOSS_POOR,
)

_HEALTH_LABELS = {
    "healthy": "Healthy",
    "degraded": "Degraded",
    "poor": "Poor",
    "offline": "Offline",
    "no_data": "No data",
}
_SEVERITY_RANK = {"healthy": 0, "degraded": 1, "poor": 2, "offline": 3}


def _loss_severity(packet_loss_pct: float) -> tuple[str, str | None]:
    if packet_loss_pct >= HEALTH_LOSS_OFFLINE:
        return "offline", f"packet loss {packet_loss_pct:.1f}%"
    if packet_loss_pct >= HEALTH_LOSS_POOR:
        return "poor", f"packet loss {packet_loss_pct:.1f}%"
    if packet_loss_pct >= HEALTH_LOSS_DEGRADED:
        return "degraded", f"packet loss {packet_loss_pct:.1f}%"
    return "healthy", None


def _latency_severity(latency_avg_ms: float) -> tuple[str, str | None]:
    if latency_avg_ms >= HEALTH_LATENCY_POOR:
        return "poor", f"avg latency {latency_avg_ms:.1f} ms"
    if latency_avg_ms >= HEALTH_LATENCY_DEGRADED:
        return "degraded", f"avg latency {latency_avg_ms:.1f} ms"
    return "healthy", None


def _jitter_severity(jitter_avg_ms: float) -> tuple[str, str | None]:
    if jitter_avg_ms >= HEALTH_JITTER_POOR:
        return "poor", f"avg jitter {jitter_avg_ms:.1f} ms"
    if jitter_avg_ms >= HEALTH_JITTER_DEGRADED:
        return "degraded", f"avg jitter {jitter_avg_ms:.1f} ms"
    return "healthy", None


def compute_health(stats: dict) -> dict:
    if stats.get("sample_count", 0) == 0:
        return {"level": "no_data", "label": _HEALTH_LABELS["no_data"], "reasons": []}

    packet_loss_pct = stats.get("packet_loss_pct", 0.0)
    if packet_loss_pct >= HEALTH_LOSS_OFFLINE:
        return {
            "level": "offline",
            "label": _HEALTH_LABELS["offline"],
            "reasons": [f"packet loss {packet_loss_pct:.1f}%"],
        }

    evaluations: list[tuple[str, str | None]] = [
        _loss_severity(packet_loss_pct),
    ]

    latency_avg_ms = stats.get("latency_avg_ms")
    if latency_avg_ms is not None:
        evaluations.append(_latency_severity(latency_avg_ms))

    jitter_avg_ms = stats.get("jitter_avg_ms")
    if jitter_avg_ms is not None:
        evaluations.append(_jitter_severity(jitter_avg_ms))

    worst_level = "healthy"
    reasons: list[str] = []
    for level, reason in evaluations:
        if _SEVERITY_RANK[level] > _SEVERITY_RANK[worst_level]:
            worst_level = level
            reasons = [reason] if reason else []
        elif level == worst_level and reason:
            reasons.append(reason)

    return {
        "level": worst_level,
        "label": _HEALTH_LABELS[worst_level],
        "reasons": reasons,
    }
