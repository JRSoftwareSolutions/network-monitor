<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { ChartBucket } from "../lib/api";
  import {
    buildJitterSeries,
    createJitterChart,
    jitterSeriesEqual,
    updateJitterChart,
    xScaleBounds,
  } from "../lib/charts";
  import { chartTheme } from "../lib/theme";
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  let {
    title = "Jitter",
    buckets = [] as ChartBucket[],
    windowMinutes = 30,
    bucketSeconds = 1,
    chartRevision = 0,
    viewportMs = Date.now(),
  }: {
    title?: string;
    buckets?: ChartBucket[];
    windowMinutes?: number;
    bucketSeconds?: number;
    chartRevision?: number;
    viewportMs?: number;
  } = $props();

  let container: HTMLDivElement;
  let chart = $state<uPlot | null>(null);
  let lastAppliedRevision = -1;
  let lastTimes: number[] = [];
  let lastAvg: (number | null)[] = [];
  let lastBounds: { min: number; max: number } | null = null;
  let lastBucketSeconds = 0;

  onMount(() => {
    const { times, max, min, avg } = buildJitterSeries(buckets);
    const bounds = xScaleBounds(windowMinutes, viewportMs);
    chart = createJitterChart(container, times, min, max, avg, bucketSeconds, bounds);
    lastAppliedRevision = chartRevision;
    lastTimes = times;
    lastAvg = avg;
    lastBounds = bounds;
    lastBucketSeconds = bucketSeconds;

    let lastWidth = 0;
    let lastHeight = 0;

    const ro = new ResizeObserver(() => {
      if (!chart || !container) return;
      const width = container.clientWidth;
      const height = container.clientHeight || chartTheme(container).height;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      chart.setSize({ width, height });
    });
    ro.observe(container);
    const page = container.closest(".page");
    if (page) ro.observe(page);

    return () => {
      ro.disconnect();
      chart?.destroy();
    };
  });

  $effect(() => {
    const revision = chartRevision;
    if (!chart || revision === lastAppliedRevision) return;

    const { times, max, min, avg } = buildJitterSeries(untrack(() => buckets));
    const wm = untrack(() => windowMinutes);
    const bs = untrack(() => bucketSeconds);
    const vp = untrack(() => viewportMs);
    const bounds = xScaleBounds(wm, vp);

    if (
      jitterSeriesEqual({ times: lastTimes, avg: lastAvg }, { times, avg }) &&
      lastBounds?.min === bounds.min &&
      lastBounds?.max === bounds.max &&
      lastBucketSeconds === bs
    ) {
      lastAppliedRevision = revision;
      return;
    }

    updateJitterChart(chart, times, min, max, avg, bs, bounds);
    lastAppliedRevision = revision;
    lastTimes = times;
    lastAvg = avg;
    lastBounds = bounds;
    lastBucketSeconds = bs;
  });
</script>

<section class="card">
  <h2>{title}</h2>
  <div class="chart-wrap" bind:this={container}></div>
</section>

<style>
  .chart-wrap {
    contain: strict;
    flex: 1;
    min-height: var(--layout-chart-min-height);
    height: 100%;
  }
</style>
