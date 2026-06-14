from datetime import datetime, timedelta, timezone

from src.metrics import (
    BLOCKS_BUCKET_SECONDS,
    NOW_WINDOW_SECONDS,
    TREND_PRIOR_SECONDS,
    TREND_RECENT_SECONDS,
    VerdictStabilizer,
    bucket_samples,
    build_status_narrative,
    compute_baseline_and_spikes,
    compute_health,
    compute_instant_verdict,
    compute_now_stats,
    compute_stats,
    compute_trend,
    detect_outages,
    downsample_samples,
    parse_ts,
    sort_samples_by_ts,
)
from src.ping_monitor import PingMonitor
from src.sample_utils import ceil_div


def trend_window_minutes() -> int:
    return ceil_div(TREND_RECENT_SECONDS + TREND_PRIOR_SECONDS, 60)


def now_window_minutes() -> int:
    return ceil_div(NOW_WINDOW_SECONDS, 60)


def filter_samples(samples: list[dict], window_minutes: int) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    return [sample for sample in samples if parse_ts(sample["ts"]) >= cutoff]


def build_now_payload(
    trend_samples: list[dict],
    stabilizer: VerdictStabilizer,
) -> dict:
    now_samples = filter_samples(trend_samples, now_window_minutes())
    now_stats = compute_now_stats(now_samples)
    flow = compute_baseline_and_spikes(now_samples)
    instant = compute_instant_verdict(now_stats, flow)
    display = stabilizer.update(instant["level"])
    trend = compute_trend(trend_samples)
    narrative = build_status_narrative(
        now_stats=now_stats,
        flow=flow,
        verdict=instant,
        display=display,
        trend=trend,
    )

    return {
        "window_seconds": NOW_WINDOW_SECONDS,
        "stats": now_stats,
        "baseline_ms": flow["baseline_ms"],
        "spike_threshold_ms": flow["spike_threshold_ms"],
        "spike_count": flow["spike_count"],
        "spike_rate_per_min": flow["spike_rate_per_min"],
        "worst_spike": flow["worst_spike"],
        "ratings": instant["ratings"],
        "indicators": instant["indicators"],
        "instant_verdict": {
            "level": instant["level"],
            "label": instant["label"],
            "reasons": instant["reasons"],
        },
        "display_verdict": display,
        "trend": trend,
        "narrative": narrative,
    }


def build_live_payload(monitor: PingMonitor, stabilizer: VerdictStabilizer) -> dict:
    trend_samples = monitor.get_samples(trend_window_minutes())
    latest = monitor.get_latest_sample()
    return {
        "latest_ts": latest["ts"] if latest else None,
        "recent_samples": monitor.get_recent_samples(60),
        "now": build_now_payload(trend_samples, stabilizer),
    }


def build_metrics_payload(
    monitor: PingMonitor,
    stabilizer: VerdictStabilizer,
    window: int,
) -> dict:
    trend_minutes = trend_window_minutes()
    fetch_minutes = max(window, trend_minutes)
    all_samples = monitor.get_samples(fetch_minutes)
    samples = sort_samples_by_ts(
        filter_samples(all_samples, window) if fetch_minutes != window else all_samples
    )
    trend_samples = sort_samples_by_ts(filter_samples(all_samples, trend_minutes))

    stats = compute_stats(samples)
    chart_samples = downsample_samples(samples, window_minutes=window)

    return {
        "window_minutes": window,
        "latest_ts": samples[-1]["ts"] if samples else None,
        "samples": chart_samples,
        "recent_samples": monitor.get_recent_samples(60),
        "sample_count_raw": len(samples),
        "stats": stats,
        "health": compute_health(stats),
        "now": build_now_payload(trend_samples, stabilizer),
        "outages": detect_outages(samples),
        "blocks": {
            "window_minutes": window,
            "bucket_seconds": BLOCKS_BUCKET_SECONDS,
            "buckets": bucket_samples(
                samples,
                BLOCKS_BUCKET_SECONDS,
                window_minutes=window,
            ),
        },
    }
