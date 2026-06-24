import { describe, expect, it } from "vitest";
import {
  bucketCenterMs,
  bucketStartMs,
  buildJitterSeries,
  buildLatencySeries,
  createChartLiveIngest,
  displayBuckets,
  emptyChartBuffer,
  hydrateChartBuffer,
  ingestSample,
  latencySeriesEqual,
  mergeChartBuckets,
  stripTrailingOpenBucket,
} from "./charts";
import type { ChartBucket, Sample } from "./api";
import { CHART_BASELINE_POINTS, displayBucketSeconds } from "./windows";

describe("buildLatencySeries", () => {
  it("maps bucket fields to chart series", () => {
    const buckets: ChartBucket[] = [
      { ts: "2026-06-16T11:59:00.000Z", avg_ms: 15, min_ms: 10, max_ms: 20, sample_count: 3 },
      { ts: "2026-06-16T11:59:30.000Z", avg_ms: 25, min_ms: 22, max_ms: 30, sample_count: 2 },
    ];
    const { times, max, min, avg } = buildLatencySeries(buckets);
    expect(times).toHaveLength(2);
    expect(avg).toEqual([15, 25]);
    expect(min).toEqual([10, 22]);
    expect(max).toEqual([20, 30]);
  });
});

describe("buildJitterSeries", () => {
  it("maps jitter bucket fields to chart series", () => {
    const buckets: ChartBucket[] = [
      {
        ts: "2026-06-16T11:59:00.000Z",
        avg_jitter_ms: 5,
        min_jitter_ms: 2,
        max_jitter_ms: 8,
        sample_count: 3,
      },
      {
        ts: "2026-06-16T11:59:30.000Z",
        avg_jitter_ms: 12,
        min_jitter_ms: 10,
        max_jitter_ms: 15,
        sample_count: 2,
      },
    ];
    const { times, max, min, avg } = buildJitterSeries(buckets);
    expect(times).toHaveLength(2);
    expect(avg).toEqual([5, 12]);
    expect(min).toEqual([2, 10]);
    expect(max).toEqual([8, 15]);
  });
});

describe("displayBucketSeconds", () => {
  it("matches Go tier table", () => {
    expect(displayBucketSeconds(5)).toBe(1);
    expect(displayBucketSeconds(15)).toBe(3);
    expect(displayBucketSeconds(30)).toBe(6);
    expect(displayBucketSeconds(60)).toBe(12);
    expect(displayBucketSeconds(120)).toBe(24);
    expect(displayBucketSeconds(180)).toBe(36);
  });

  it("targets baseline point count for bucketed windows", () => {
    expect((30 * 60) / displayBucketSeconds(30)).toBe(CHART_BASELINE_POINTS);
    expect((5 * 60) / displayBucketSeconds(5)).toBe(CHART_BASELINE_POINTS);
  });
});

describe("bucketStartMs", () => {
  it("aligns to epoch bin boundaries", () => {
    const tsMs = Date.parse("2026-06-16T12:00:37.000Z");
    const start = bucketStartMs(tsMs, 10);
    expect(start).toBe(Date.parse("2026-06-16T12:00:30.000Z"));
    expect(bucketCenterMs(start, 10)).toBe(Date.parse("2026-06-16T12:00:35.000Z"));
  });
});

describe("mergeChartBuckets", () => {
  it("merges min max and weighted avg", () => {
    const a: ChartBucket = {
      ts: "2026-06-16T12:00:00.000Z",
      avg_ms: 10,
      min_ms: 8,
      max_ms: 12,
      avg_jitter_ms: 2,
      min_jitter_ms: 1,
      max_jitter_ms: 3,
      sample_count: 2,
    };
    const b: ChartBucket = {
      ts: "2026-06-16T12:00:05.000Z",
      avg_ms: 20,
      min_ms: 15,
      max_ms: 50,
      avg_jitter_ms: 6,
      min_jitter_ms: 4,
      max_jitter_ms: 10,
      sample_count: 3,
    };
    const merged = mergeChartBuckets(a, b);
    expect(merged.min_ms).toBe(8);
    expect(merged.max_ms).toBe(50);
    expect(merged.sample_count).toBe(5);
    expect(merged.avg_ms).toBeCloseTo(16);
    expect(merged.min_jitter_ms).toBe(1);
    expect(merged.max_jitter_ms).toBe(10);
    expect(merged.avg_jitter_ms).toBeCloseTo(4.4);
  });
});

describe("ingestSample", () => {
  const sample = (ts: string, latency: number, jitter?: number): Sample => ({
    ts,
    host: "1.1.1.1",
    success: true,
    latency_ms: latency,
    jitter_ms: jitter,
  });

  it("accumulates in open bin without finalizing", () => {
    let buffer = emptyChartBuffer();
    const first = ingestSample(buffer, sample("2026-06-16T12:00:37.000Z", 10), 10);
    expect(first.finalized).toBe(false);
    expect(first.buffer.completed).toHaveLength(0);
    expect(first.buffer.open?.sample_count).toBe(1);

    const second = ingestSample(first.buffer, sample("2026-06-16T12:00:39.000Z", 42), 10);
    expect(second.finalized).toBe(false);
    expect(second.buffer.completed).toHaveLength(0);
    expect(second.buffer.open?.sample_count).toBe(2);
    expect(second.buffer.open?.max_ms).toBe(42);
  });

  it("finalizes previous bin when a new bin starts", () => {
    let buffer = emptyChartBuffer();
    buffer = ingestSample(buffer, sample("2026-06-16T12:00:37.000Z", 10), 10).buffer;
    const crossed = ingestSample(buffer, sample("2026-06-16T12:00:47.000Z", 20), 10);
    expect(crossed.finalized).toBe(true);
    expect(crossed.buffer.completed).toHaveLength(1);
    expect(crossed.buffer.completed[0].sample_count).toBe(1);
    expect(crossed.buffer.open?.avg_ms).toBe(20);
  });

  it("accumulates jitter in open bin", () => {
    let buffer = emptyChartBuffer();
    buffer = ingestSample(buffer, sample("2026-06-16T12:00:37.000Z", 10, 2), 10).buffer;
    const second = ingestSample(buffer, sample("2026-06-16T12:00:39.000Z", 42, 8), 10);
    expect(second.buffer.open?.max_jitter_ms).toBe(8);
    expect(second.buffer.open?.min_jitter_ms).toBe(2);
  });
});

describe("displayBuckets", () => {
  it("excludes open bin from chart display", () => {
    const buffer = {
      completed: [
        { ts: "2026-06-16T11:59:00.000Z", avg_ms: 10, min_ms: 10, max_ms: 10, sample_count: 1 },
      ],
      open: { ts: "2026-06-16T12:00:00.000Z", avg_ms: 20, min_ms: 20, max_ms: 20, sample_count: 1 },
      openBinStartMs: Date.parse("2026-06-16T12:00:00.000Z"),
    };
    const now = Date.parse("2026-06-16T12:00:30.000Z");
    const out = displayBuckets(buffer, 30, now);
    expect(out).toHaveLength(1);
    expect(out[0].avg_ms).toBe(10);
  });
});

describe("stripTrailingOpenBucket", () => {
  it("removes trailing bucket in the current epoch bin", () => {
    const now = Date.parse("2026-06-16T12:00:37.000Z");
    const buckets: ChartBucket[] = [
      { ts: "2026-06-16T12:00:05.000Z", avg_ms: 10, min_ms: 10, max_ms: 10, sample_count: 1 },
      { ts: "2026-06-16T12:00:35.000Z", avg_ms: 20, min_ms: 20, max_ms: 20, sample_count: 1 },
    ];
    const out = stripTrailingOpenBucket(buckets, 10, now);
    expect(out).toHaveLength(1);
    expect(out[0].avg_ms).toBe(10);
  });
});

describe("hydrateChartBuffer", () => {
  it("strips trailing open bucket from API data", () => {
    const now = Date.parse("2026-06-16T12:00:37.000Z");
    const apiBuckets: ChartBucket[] = [
      { ts: "2026-06-16T12:00:05.000Z", avg_ms: 10, min_ms: 10, max_ms: 10, sample_count: 1 },
      { ts: "2026-06-16T12:00:35.000Z", avg_ms: 20, min_ms: 20, max_ms: 20, sample_count: 1 },
    ];
    const buffer = hydrateChartBuffer(apiBuckets, 10, now);
    expect(buffer.completed).toHaveLength(1);
    expect(buffer.open).toBeNull();
  });
});

describe("latencySeriesEqual", () => {
  it("detects identical series", () => {
    const a = { times: [1, 2], avg: [10, 20] };
    expect(latencySeriesEqual(a, { times: [1, 2], avg: [10, 20] })).toBe(true);
  });

  it("detects changed values", () => {
    const a = { times: [1, 2], avg: [10, 20] };
    expect(latencySeriesEqual(a, { times: [1, 2], avg: [10, 21] })).toBe(false);
  });
});

describe("createChartLiveIngest", () => {
  const sample = (ts: string, latency: number, jitter?: number): Sample => ({
    ts,
    host: "1.1.1.1",
    success: true,
    latency_ms: latency,
    jitter_ms: jitter,
  });

  it("returns pending without a display snapshot while accumulating an open bin", () => {
    const live = createChartLiveIngest(10);
    const first = live.ingest(sample("2026-06-16T12:00:37.000Z", 10), 30);
    expect(first.kind).toBe("pending");
    const second = live.ingest(sample("2026-06-16T12:00:39.000Z", 42), 30);
    expect(second.kind).toBe("pending");
  });

  it("returns a snapshot only when a bin is finalized", () => {
    const live = createChartLiveIngest(10);
    live.ingest(sample("2026-06-16T12:00:37.000Z", 10), 30);
    const crossed = live.ingest(sample("2026-06-16T12:00:47.000Z", 20), 30);
    expect(crossed.kind).toBe("finalized");
    if (crossed.kind === "finalized") {
      expect(crossed.snapshot.buckets).toHaveLength(1);
      expect(crossed.snapshot.buckets[0].avg_ms).toBe(10);
    }
  });
});
