<script lang="ts">
  import ConnectionQualityBar from "./ConnectionQualityBar.svelte";
  import type { StatusTier } from "../lib/status";
  import { formatMs, formatPercent } from "../lib/status";

  let {
    title = "Connection",
    status = "offline" as StatusTier,
    qualityPercent = 100,
    avgLatency,
    lossPercent,
  }: {
    title?: string;
    status?: StatusTier;
    qualityPercent?: number;
    avgLatency?: number;
    lossPercent?: number;
  } = $props();
</script>

<section class="card" data-status={status}>
  <h2>{title}</h2>
  <ConnectionQualityBar quality={qualityPercent} {status} />
  <dl class="stat-grid">
    <div>
      <dt class="stat-label">Avg latency</dt>
      <dd class="stat-value">{formatMs(avgLatency)}</dd>
    </div>
    <div>
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
