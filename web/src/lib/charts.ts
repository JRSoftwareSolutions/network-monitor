import uPlot from "uplot";

import type { ChartBucket, Sample } from "./api";

import { filterBucketsByWindow, parseTs } from "./time";

import { chartTheme } from "./theme";

const NS_PER_SEC = 1_000_000_000;

const chartBandMeta = new WeakMap<
  uPlot,
  { times: number[]; min: (number | null)[]; max: (number | null)[]; bucketSeconds: number }
>();

export type RangeBandState = {
  times: number[];
  min: (number | null)[];
  max: (number | null)[];
  bucketSeconds: number;
};

export function xScaleBounds(windowMinutes: number, nowMs: number): { min: number; max: number } {
  const max = nowMs / 1000;
  return { min: max - windowMinutes * 60, max };
}

export function bucketStartMs(tsMs: number, bucketSeconds: number): number {
  if (bucketSeconds <= 0) {
    return tsMs;
  }
  const nsPerBucket = Math.floor(bucketSeconds * NS_PER_SEC);
  if (nsPerBucket <= 0) {
    return tsMs;
  }
  const tsNs = tsMs * 1_000_000;
  const bin = Math.floor(tsNs / nsPerBucket);
  return (bin * nsPerBucket) / 1_000_000;
}

export function bucketCenterMs(binStartMs: number, bucketSeconds: number): number {
  if (bucketSeconds <= 0) {
    return binStartMs;
  }
  return binStartMs + (bucketSeconds * 1000) / 2;
}

export function mergeChartBuckets(a: ChartBucket, b: ChartBucket): ChartBucket {
  const sampleCount = a.sample_count + b.sample_count;

  let minMs: number | null = a.min_ms ?? null;
  if (b.min_ms != null) {
    minMs = minMs == null ? b.min_ms : Math.min(minMs, b.min_ms);
  }

  let maxMs: number | null = a.max_ms ?? null;
  if (b.max_ms != null) {
    maxMs = maxMs == null ? b.max_ms : Math.max(maxMs, b.max_ms);
  }

  let avgNumer = 0;
  let avgDenom = 0;
  if (a.avg_ms != null) {
    avgNumer += a.avg_ms * a.sample_count;
    avgDenom += a.sample_count;
  }
  if (b.avg_ms != null) {
    avgNumer += b.avg_ms * b.sample_count;
    avgDenom += b.sample_count;
  }

  return {
    ts: a.ts,
    sample_count: sampleCount,
    avg_ms: avgDenom > 0 ? avgNumer / avgDenom : null,
    min_ms: minMs,
    max_ms: maxMs,
  };
}

export function sampleToBucket(sample: Sample): ChartBucket {
  const bucket: ChartBucket = { ts: sample.ts, sample_count: 1 };
  if (sample.success && sample.latency_ms != null) {
    bucket.avg_ms = sample.latency_ms;
    bucket.min_ms = sample.latency_ms;
    bucket.max_ms = sample.latency_ms;
  }
  return bucket;
}

export function mergeSampleIntoBucket(bucket: ChartBucket, sample: Sample): ChartBucket {
  return mergeChartBuckets(bucket, sampleToBucket(sample));
}

export type ChartBuffer = {
  completed: ChartBucket[];
  open: ChartBucket | null;
  openBinStartMs: number | null;
};

export function emptyChartBuffer(): ChartBuffer {
  return { completed: [], open: null, openBinStartMs: null };
}

export function ingestSample(
  buffer: ChartBuffer,
  sample: Sample,
  bucketSeconds: number,
): { buffer: ChartBuffer; finalized: boolean } {
  const tsMs = parseTs(sample.ts);
  const binStartMs = bucketStartMs(tsMs, bucketSeconds);

  if (buffer.openBinStartMs === binStartMs && buffer.open != null) {
    return {
      buffer: {
        ...buffer,
        open: mergeSampleIntoBucket(buffer.open, sample),
      },
      finalized: false,
    };
  }

  let completed = buffer.completed;
  let finalized = false;

  if (buffer.open != null) {
    completed = [...completed, buffer.open];
    finalized = true;
  }

  const centerMs = bucketCenterMs(binStartMs, bucketSeconds);
  const open = mergeSampleIntoBucket(
    { ts: new Date(centerMs).toISOString(), sample_count: 0 },
    sample,
  );

  return {
    buffer: { completed, open, openBinStartMs: binStartMs },
    finalized,
  };
}

export function stripTrailingOpenBucket(
  buckets: ChartBucket[],
  bucketSeconds: number,
  nowMs: number,
): ChartBucket[] {
  if (buckets.length === 0) return buckets;
  const currentBinStart = bucketStartMs(nowMs, bucketSeconds);
  const last = buckets[buckets.length - 1];
  const lastBinStart = bucketStartMs(parseTs(last.ts), bucketSeconds);
  if (lastBinStart === currentBinStart) {
    return buckets.slice(0, -1);
  }
  return buckets;
}

export function hydrateChartBuffer(
  apiBuckets: ChartBucket[],
  bucketSeconds: number,
  nowMs: number,
): ChartBuffer {
  return {
    completed: stripTrailingOpenBucket(apiBuckets, bucketSeconds, nowMs),
    open: null,
    openBinStartMs: null,
  };
}

export function displayBuckets(
  buffer: ChartBuffer,
  windowMinutes: number,
  nowMs: number,
): ChartBucket[] {
  return filterBucketsByWindow(buffer.completed, windowMinutes, nowMs);
}

export function filterChartBufferWindow(
  buffer: ChartBuffer,
  windowMinutes: number,
  nowMs: number,
): ChartBuffer {
  return {
    ...buffer,
    completed: filterBucketsByWindow(buffer.completed, windowMinutes, nowMs),
  };
}

export function buildLatencySeries(buckets: ChartBucket[]): {
  times: number[];
  max: (number | null)[];
  min: (number | null)[];
  avg: (number | null)[];
} {
  const times: number[] = [];
  const max: (number | null)[] = [];
  const min: (number | null)[] = [];
  const avg: (number | null)[] = [];

  for (const b of buckets) {
    times.push(parseTs(b.ts) / 1000);
    max.push(b.max_ms ?? null);
    min.push(b.min_ms ?? null);
    avg.push(b.avg_ms ?? null);
  }

  return { times, max, min, avg };
}

export function latencySeriesEqual(
  a: { times: number[]; avg: (number | null)[] },
  b: { times: number[]; avg: (number | null)[] },
): boolean {
  if (a.times.length !== b.times.length) return false;
  for (let i = 0; i < a.times.length; i++) {
    if (a.times[i] !== b.times[i] || a.avg[i] !== b.avg[i]) return false;
  }
  return true;
}

function bucketHalfWidthPx(u: uPlot, times: number[], i: number, bucketSeconds: number): number {
  const x = u.valToPos(times[i], "x");
  if (bucketSeconds > 0) {
    const xLeft = u.valToPos(times[i] - bucketSeconds / 2, "x");
    const xRight = u.valToPos(times[i] + bucketSeconds / 2, "x");
    return (Math.abs(xRight - xLeft) / 2) * 0.8;
  }
  if (i + 1 < times.length) {
    return Math.abs(u.valToPos(times[i + 1], "x") - x) * 0.4;
  }
  if (i > 0) {
    return Math.abs(x - u.valToPos(times[i - 1], "x")) * 0.4;
  }
  return 3;
}

function yRangeFromState(state: RangeBandState | undefined, dataMin: number | null, dataMax: number | null) {
  let lo = dataMin ?? 0;
  let hi = dataMax ?? 100;
  if (state) {
    for (let i = 0; i < state.min.length; i++) {
      if (state.min[i] != null) lo = Math.min(lo, state.min[i]!);
      if (state.max[i] != null) hi = Math.max(hi, state.max[i]!);
    }
  }
  lo = Math.min(0, lo);
  return [lo, hi === lo ? lo + 100 : hi * 1.05] as uPlot.Range.MinMax;
}

function createRangeBandPlugin(): uPlot.Plugin {
  return {
    hooks: {
      draw: [
        (u) => {
          const state = chartBandMeta.get(u);
          if (!state || state.times.length === 0) return;

          const theme = chartTheme(u.root);
          const { ctx } = u;
          const { times, min, max, bucketSeconds } = state;

          ctx.save();
          ctx.fillStyle = theme.envelopeFill;
          ctx.strokeStyle = theme.envelopeStroke;
          ctx.lineWidth = 1;

          for (let i = 0; i < times.length; i++) {
            const lo = min[i];
            const hi = max[i];
            if (lo == null || hi == null) continue;

            const x = u.valToPos(times[i], "x");
            const yTop = u.valToPos(hi, "y");
            const yBot = u.valToPos(lo, "y");
            const halfW = bucketHalfWidthPx(u, times, i, bucketSeconds);
            const left = x - halfW;
            const width = halfW * 2;
            const top = Math.min(yTop, yBot);
            const height = Math.max(Math.abs(yBot - yTop), 1);

            ctx.fillRect(left, top, width, height);
            ctx.beginPath();
            ctx.moveTo(left, yTop);
            ctx.lineTo(left + width, yTop);
            ctx.moveTo(left, yBot);
            ctx.lineTo(left + width, yBot);
            ctx.stroke();
          }

          ctx.restore();
        },
      ],
    },
  };
}

export function createLatencyChart(
  el: HTMLElement,
  times: number[],
  min: (number | null)[],
  max: (number | null)[],
  avg: (number | null)[],
  bucketSeconds: number,
  bounds: { min: number; max: number },
): uPlot {
  const theme = chartTheme(el);
  const initialMeta: RangeBandState = { times, min, max, bucketSeconds };

  const opts: uPlot.Options = {
    width: el.clientWidth || 640,
    height: theme.height,
    plugins: [createRangeBandPlugin()],
    series: [
      {},
      {
        label: "Latency",
        stroke: theme.seriesStroke,
        width: 2,
        spanGaps: true,
      },
    ],
    axes: [
      { stroke: theme.axisStroke },
      {
        stroke: theme.axisStroke,
        label: "ms",
      },
    ],
    scales: {
      x: {
        time: true,
        min: bounds.min,
        max: bounds.max,
      },
      y: {
        range: (u, dataMin, dataMax) =>
          yRangeFromState(chartBandMeta.get(u) ?? initialMeta, dataMin, dataMax),
      },
    },
  };

  const chart = new uPlot(opts, [times, avg], el);
  chartBandMeta.set(chart, initialMeta);
  return chart;
}

export function updateLatencyChartData(
  chart: uPlot,
  times: number[],
  min: (number | null)[],
  max: (number | null)[],
  avg: (number | null)[],
  bucketSeconds: number,
) {
  chartBandMeta.set(chart, { times, min, max, bucketSeconds });
  chart.setData([times, avg]);
}

export function scrollLatencyChart(chart: uPlot, bounds: { min: number; max: number }) {
  chart.setScale("x", bounds);
}

export function updateLatencyChart(
  chart: uPlot,
  times: number[],
  min: (number | null)[],
  max: (number | null)[],
  avg: (number | null)[],
  bucketSeconds: number,
  bounds: { min: number; max: number },
) {
  scrollLatencyChart(chart, bounds);
  updateLatencyChartData(chart, times, min, max, avg, bucketSeconds);
}

export type ChartLiveSnapshot = {
  buckets: ChartBucket[];
  viewportMs: number;
  bucketSeconds: number;
};

export type ChartIngestResult = { kind: "pending" } | { kind: "finalized"; snapshot: ChartLiveSnapshot };

/** Mutable chart buffer for SSE merges; does not trigger Svelte reactivity until finalized. */
export function createChartLiveIngest(initialBucketSeconds: number) {
  let buffer = emptyChartBuffer();
  let bucketSeconds = initialBucketSeconds;

  return {
    hydrate(
      apiBuckets: ChartBucket[],
      secs: number,
      windowMinutes: number,
      nowMs: number,
    ): ChartLiveSnapshot {
      bucketSeconds = secs;
      buffer = hydrateChartBuffer(apiBuckets, secs, nowMs);
      return {
        buckets: displayBuckets(buffer, windowMinutes, nowMs),
        viewportMs: nowMs,
        bucketSeconds,
      };
    },
    ingest(sample: Sample, windowMinutes: number): ChartIngestResult {
      const sampleMs = parseTs(sample.ts);
      const { buffer: next, finalized } = ingestSample(buffer, sample, bucketSeconds);
      if (!finalized) {
        buffer = next;
        return { kind: "pending" };
      }
      buffer = filterChartBufferWindow(next, windowMinutes, sampleMs);
      return {
        kind: "finalized",
        snapshot: {
          buckets: displayBuckets(buffer, windowMinutes, sampleMs),
          viewportMs: sampleMs,
          bucketSeconds,
        },
      };
    },
  };
}
