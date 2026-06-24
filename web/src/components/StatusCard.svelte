<script lang="ts">
  import ConnectionQualityBar from "./ConnectionQualityBar.svelte";
  import type { Thresholds } from "../lib/api";
  import type { MetricQuality, StatusTier } from "../lib/status";
  import {
    DEFAULT_THRESHOLDS,
    formatMs,
    formatPercent,
    latencyQuality,
    lossQuality,
  } from "../lib/status";

  let {
    title = "Connection",
    status = "offline" as StatusTier,
    qualityPercent = 100,
    thresholds = DEFAULT_THRESHOLDS,
    avgLatency,
    p95Latency,
    lossPercent,
  }: {
    title?: string;
    status?: StatusTier;
    qualityPercent?: number;
    thresholds?: Thresholds;
    avgLatency?: number;
    p95Latency?: number;
    lossPercent?: number;
  } = $props();

  function statQuality(
    value: number | null | undefined,
    classify: (v: number | null | undefined, t: Thresholds) => MetricQuality,
  ): MetricQuality {
    if (value == null) {
      return status === "offline" ? "offline" : "unknown";
    }
    return classify(value, thresholds);
  }

  const avgLatencyQuality = $derived(statQuality(avgLatency, latencyQuality));
  const p95LatencyQuality = $derived(statQuality(p95Latency, latencyQuality));
  const lossQualityTier = $derived(statQuality(lossPercent, lossQuality));
</script>

<section class="card" data-status={status}>
  <h2>{title}</h2>
  <ConnectionQualityBar quality={qualityPercent} {status} />
  <dl class="stat-grid">
    <div class="quality-indicated" data-quality={avgLatencyQuality}>
      <dt class="stat-label">Avg latency</dt>
      <dd class="stat-value">{formatMs(avgLatency)}</dd>
    </div>
    <div class="quality-indicated" data-quality={p95LatencyQuality}>
      <dt class="stat-label">P95 latency</dt>
      <dd class="stat-value">{formatMs(p95Latency)}</dd>
    </div>
    <div class="quality-indicated" data-quality={lossQualityTier}>
      <dt class="stat-label">Packet loss</dt>
      <dd class="stat-value">{formatPercent(lossPercent)}</dd>
    </div>
  </dl>
</section>

<style>
  dl {
    grid-template-columns: var(--layout-stat-columns);
    margin: 0;
  }

  dd {
    margin: var(--space-1) 0 0;
    font-variant-numeric: tabular-nums;
  }
</style>
