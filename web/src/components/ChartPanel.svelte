<script lang="ts">
  import { onMount } from "svelte";
  import LatencyChart from "./LatencyChart.svelte";
  import { getChartBuckets, type ChartBucket } from "../lib/api";
  import { createChartLiveIngest, type ChartLiveSnapshot } from "../lib/charts";
  import { publishChartSample, subscribeChartReload, subscribeChartSample } from "../lib/chartSample";
  import { requestSummaryRefresh } from "../lib/summaryRefresh";
  import { DASHBOARD_METRICS, displayBucketSeconds } from "../lib/windows";

  let { windowMinutes = 30 }: { windowMinutes?: number } = $props();

  let chartBuckets = $state<ChartBucket[]>([]);
  let bucketSeconds = $state(displayBucketSeconds(windowMinutes));
  let chartRevision = $state(0);
  let chartViewportMs = $state(Date.now());

  let chartLive = createChartLiveIngest(displayBucketSeconds(windowMinutes));
  let loadSeq = 0;

  function resetChartLive(minutes: number) {
    chartLive = createChartLiveIngest(displayBucketSeconds(minutes));
  }

  function applyChartSnapshot(snapshot: ChartLiveSnapshot) {
    chartBuckets = snapshot.buckets;
    chartViewportMs = snapshot.viewportMs;
    bucketSeconds = snapshot.bucketSeconds;
    chartRevision++;
  }

  async function reloadChart(minutes: number) {
    const seq = ++loadSeq;
    resetChartLive(minutes);
    const bucketsRes = await getChartBuckets(minutes);
    if (seq !== loadSeq) return;
    applyChartSnapshot(
      chartLive.hydrate(bucketsRes.buckets, bucketsRes.bucket_seconds, minutes, Date.now()),
    );
  }

  function ingestSample(sample: Parameters<typeof publishChartSample>[0], minutes: number) {
    const result = chartLive.ingest(sample, minutes);
    if (result.kind === "finalized") {
      applyChartSnapshot(result.snapshot);
      requestSummaryRefresh(minutes);
    }
  }

  onMount(() => {
    const unsubSample = subscribeChartSample((sample, minutes) => {
      if (minutes !== windowMinutes) return;
      ingestSample(sample, minutes);
    });
    const unsubReload = subscribeChartReload((minutes) => {
      if (minutes !== windowMinutes) return;
      void reloadChart(minutes);
    });
    return () => {
      unsubSample();
      unsubReload();
    };
  });

  $effect(() => {
    void reloadChart(windowMinutes);
  });
</script>

<div class="dashboard-panel chart-span">
  <LatencyChart
    title={DASHBOARD_METRICS.latencyChart.title(windowMinutes)}
    buckets={chartBuckets}
    {windowMinutes}
    {bucketSeconds}
    {chartRevision}
    viewportMs={chartViewportMs}
  />
</div>
