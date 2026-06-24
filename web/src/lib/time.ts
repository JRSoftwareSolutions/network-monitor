import type { ChartBucket } from "./api";

/** Parses an ISO timestamp to epoch milliseconds. */
export function parseTs(ts: string): number {
  return Date.parse(ts);
}

/** Filters by absolute bucket center timestamp (stable under epoch alignment). */
export function filterBucketsByWindow(
  buckets: ChartBucket[],
  minutes: number,
  nowMs: number = Date.now(),
): ChartBucket[] {
  const cutoff = nowMs - minutes * 60_000;
  let removed = false;
  const filtered = buckets.filter((b) => {
    const keep = parseTs(b.ts) >= cutoff;
    if (!keep) removed = true;
    return keep;
  });
  return removed ? filtered : buckets;
}

/** Short local time for history rows (e.g. speed test results). */
export function formatShortTime(ts: string): string {
  const ms = parseTs(ts);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
