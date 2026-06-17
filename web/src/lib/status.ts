import type { Summary, Thresholds } from "./api";

export type StatusTier = Summary["status"];

export const DEFAULT_THRESHOLDS: Thresholds = {
  ping_great: 40,
  ping_good: 70,
  ping_okay: 110,
  ping_max: 200,
  jitter_great: 8,
  jitter_good: 15,
  jitter_okay: 30,
  jitter_max: 60,
  loss_good: 1,
  loss_okay: 3,
  loss_max: 15,
};

export type QualitySummary = Pick<
  Summary,
  "sample_count" | "success_count" | "loss_percent" | "avg_latency_ms" | "avg_jitter_ms"
>;

export const COLLECTOR_STALE_INTERVALS = 3;
export const COLLECTOR_OFFLINE_INTERVALS = 10;

export function tierLabel(tier: StatusTier): string {
  switch (tier) {
    case "great":
      return "Great";
    case "ok":
      return "OK";
    case "poor":
      return "Poor";
    case "offline":
      return "Offline";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: number, good: number, bad: number): number {
  if (bad <= good) {
    return value <= good ? 0 : 1;
  }
  return clamp((value - good) / (bad - good), 0, 1);
}

export function connectionQualityPercent(
  summary: QualitySummary | null | undefined,
  thresholds: Thresholds,
): number {
  if (!summary || summary.sample_count === 0 || summary.success_count === 0) {
    return 100;
  }
  if (summary.loss_percent >= thresholds.loss_max) {
    return 100;
  }

  const ping = summary.avg_latency_ms ?? thresholds.ping_max;
  const jitter = summary.avg_jitter_ms ?? thresholds.jitter_max;

  const pingNorm = normalize(ping, thresholds.ping_great, thresholds.ping_max);
  const jitterNorm = normalize(jitter, thresholds.jitter_great, thresholds.jitter_max);
  const lossNorm = normalize(summary.loss_percent, 0, thresholds.loss_max);

  const worst = Math.max(pingNorm, jitterNorm, lossNorm);
  return Math.round(clamp(worst, 0, 1) * 100);
}

export function connectionState(
  lastTs: string | null,
  lastSuccess: boolean | null,
  pingIntervalMs: number,
  nowMs: number,
): "online" | "stale" | "offline" {
  if (!lastTs) {
    return "offline";
  }
  const age = nowMs - Date.parse(lastTs);
  const offlineMs = pingIntervalMs * COLLECTOR_OFFLINE_INTERVALS;
  const staleMs = pingIntervalMs * COLLECTOR_STALE_INTERVALS;
  if (age >= offlineMs) {
    return "offline";
  }
  if (lastSuccess === false || age >= staleMs) {
    return "stale";
  }
  return "online";
}

export function formatMs(value?: number | null): string {
  if (value == null) {
    return "—";
  }
  return `${value.toFixed(1)} ms`;
}

export function formatPercent(value?: number | null): string {
  if (value == null) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

export function formatCount(value?: number | null): string {
  if (value == null) {
    return "—";
  }
  return String(value);
}

export function lostPackets(sampleCount?: number, successCount?: number): number | undefined {
  if (sampleCount == null || successCount == null) {
    return undefined;
  }
  return sampleCount - successCount;
}
