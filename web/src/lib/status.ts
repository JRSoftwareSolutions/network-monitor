import type { Summary } from "./api";

export type StatusTier = Summary["status"];

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

export function connectionState(lastTs: string | null, staleAfterMs: number): "online" | "stale" | "offline" {
  if (!lastTs) {
    return "offline";
  }
  const age = Date.now() - Date.parse(lastTs);
  if (age > staleAfterMs * 2) {
    return "offline";
  }
  if (age > staleAfterMs) {
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

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
