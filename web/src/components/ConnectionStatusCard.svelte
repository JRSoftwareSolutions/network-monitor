<script lang="ts">
  import StatusCard from "./StatusCard.svelte";
  import { getSummary, type Summary, type Thresholds } from "../lib/api";
  import { connectionQualityPercent, DEFAULT_THRESHOLDS } from "../lib/status";
  import { subscribeSummaryRefresh } from "../lib/summaryRefresh";
  import { DASHBOARD_METRICS } from "../lib/windows";

  let {
    windowMinutes = 30,
    thresholds,
  }: {
    windowMinutes?: number;
    thresholds?: Thresholds;
  } = $props();

  let summary = $state<Summary | null>(null);
  let loadSeq = 0;

  const qualityPercent = $derived(
    connectionQualityPercent(summary, thresholds ?? DEFAULT_THRESHOLDS),
  );

  async function loadSummary(minutes: number) {
    const seq = ++loadSeq;
    const data = await getSummary(minutes);
    if (seq === loadSeq) {
      summary = data;
    }
  }

  $effect(() => {
    void loadSummary(windowMinutes);
  });

  $effect(() => {
    return subscribeSummaryRefresh((minutes) => void loadSummary(minutes));
  });
</script>

<div class="connection-status">
  <StatusCard
    title={DASHBOARD_METRICS.connection.title(windowMinutes)}
    status={summary?.status ?? "offline"}
    {qualityPercent}
    avgLatency={summary?.avg_latency_ms}
    lossPercent={summary?.loss_percent}
  />
</div>

<style>
  .connection-status {
    grid-area: connection;
    contain: layout style;
  }
</style>
