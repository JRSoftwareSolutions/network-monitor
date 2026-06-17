import { describe, expect, it } from "vitest";
import { filterBucketsByWindow } from "./time";
import { DASHBOARD_METRICS, LIVE_WINDOW_SECONDS } from "./windows";

describe("filterBucketsByWindow", () => {
  const now = Date.parse("2026-06-16T12:00:00.000Z");

  it("excludes buckets older than the window", () => {
    const buckets = [
      { ts: "2026-06-16T11:50:00.000Z", avg_ms: 10, min_ms: 10, max_ms: 10, sample_count: 1 },
      { ts: "2026-06-16T11:55:00.000Z", avg_ms: 20, min_ms: 20, max_ms: 20, sample_count: 1 },
      { ts: "2026-06-16T11:59:30.000Z", avg_ms: 30, min_ms: 30, max_ms: 30, sample_count: 1 },
    ];
    const out = filterBucketsByWindow(buckets, 5, now);
    expect(out).toHaveLength(2);
    expect(out[0].avg_ms).toBe(20);
    expect(out[1].avg_ms).toBe(30);
  });

  it("includes all buckets within the window", () => {
    const buckets = [
      { ts: "2026-06-16T11:31:00.000Z", avg_ms: 10, min_ms: 10, max_ms: 10, sample_count: 1 },
      { ts: "2026-06-16T11:45:00.000Z", avg_ms: 20, min_ms: 20, max_ms: 20, sample_count: 1 },
    ];
    const out = filterBucketsByWindow(buckets, 30, now);
    expect(out).toHaveLength(2);
  });

  it("returns the same array reference when nothing is filtered out", () => {
    const buckets = [
      { ts: "2026-06-16T11:55:00.000Z", avg_ms: 10, min_ms: 10, max_ms: 10, sample_count: 1 },
      { ts: "2026-06-16T11:59:30.000Z", avg_ms: 20, min_ms: 20, max_ms: 20, sample_count: 1 },
    ];
    const out = filterBucketsByWindow(buckets, 5, now);
    expect(out).toBe(buckets);
  });
});

describe("DASHBOARD_METRICS", () => {
  it("labels rolling metrics with selected minutes", () => {
    expect(DASHBOARD_METRICS.connection.title(30)).toBe("Connection (30 min)");
    expect(DASHBOARD_METRICS.latencyChart.title(5)).toBe("Latency (5 min)");
  });

  it("labels live metrics with fixed seconds", () => {
    expect(DASHBOARD_METRICS.live.title(30)).toBe(`Live (${LIVE_WINDOW_SECONDS}s)`);
  });
});
