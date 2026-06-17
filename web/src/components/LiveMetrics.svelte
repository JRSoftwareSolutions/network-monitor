<script lang="ts">
  import { formatCount, formatMs, formatPercent, lostPackets } from "../lib/status";

  let {
    title = "Live (60s)",
    latency,
    minLatency,
    maxLatency,
    jitter,
    minJitter,
    maxJitter,
    lossPercent,
    sampleCount,
    successCount,
  }: {
    title?: string;
    latency?: number;
    minLatency?: number;
    maxLatency?: number;
    jitter?: number;
    minJitter?: number;
    maxJitter?: number;
    lossPercent?: number;
    sampleCount?: number;
    successCount?: number;
  } = $props();

  const lost = $derived(lostPackets(sampleCount, successCount));
</script>

<section class="card live-card">
  <h2>{title}</h2>
  <div class="metrics-grid layout-metrics-grid">
    <div class="metric-tile">
      <div class="metric-primary">
        <span class="stat-label">Avg latency</span>
        <span class="stat-value">{formatMs(latency)}</span>
      </div>
      <div class="metric-detail">
        <div>
          <span class="stat-label">Min</span>
          <span class="stat-value stat-value--detail">{formatMs(minLatency)}</span>
        </div>
        <div>
          <span class="stat-label">Max</span>
          <span class="stat-value stat-value--detail">{formatMs(maxLatency)}</span>
        </div>
      </div>
    </div>
    <div class="metric-tile">
      <div class="metric-primary">
        <span class="stat-label">Avg jitter</span>
        <span class="stat-value">{formatMs(jitter)}</span>
      </div>
      <div class="metric-detail">
        <div>
          <span class="stat-label">Min</span>
          <span class="stat-value stat-value--detail">{formatMs(minJitter)}</span>
        </div>
        <div>
          <span class="stat-label">Max</span>
          <span class="stat-value stat-value--detail">{formatMs(maxJitter)}</span>
        </div>
      </div>
    </div>
    <div class="metric-tile">
      <div class="metric-primary">
        <span class="stat-label">Packet loss</span>
        <span class="stat-value">{formatPercent(lossPercent)}</span>
      </div>
      <div class="metric-detail">
        <div>
          <span class="stat-label">Lost</span>
          <span class="stat-value stat-value--detail">{formatCount(lost)}</span>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .live-card {
    grid-area: live;
    min-width: 0;
    contain: layout style;
  }

  .metrics-grid {
    display: grid;
    gap: var(--space-3);
  }

  .metric-tile {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-4);
    min-width: 0;
    background: color-mix(in srgb, var(--color-surface) 88%, white);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }

  .metric-primary {
    min-width: 0;
  }

  .metric-detail {
    display: var(--layout-metrics-detail-display);
    gap: var(--space-4);
    flex-shrink: 0;
  }

  .stat-label {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .stat-value {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
  }

  .stat-value--detail {
    font-size: var(--text-sm);
  }
</style>
