<script lang="ts">
  import { formatMbps } from "../lib/status";
  import { SPEED_BAR_MAX_MBPS, speedBarPercent } from "../lib/speedBar";

  let {
    label,
    mbps = null,
    active = false,
    showBar = false,
  }: {
    label: string;
    mbps?: number | null;
    active?: boolean;
    showBar?: boolean;
  } = $props();

  const fillPercent = $derived(speedBarPercent(mbps ?? 0));
  const displayMbps = $derived(
    active ? (mbps ?? 0) : mbps != null && mbps > 0 ? mbps : null,
  );
</script>

<div class="speed-metric-tile" data-active={active}>
  <span class="stat-label">{label}</span>
  <span class="stat-value">{formatMbps(displayMbps)}</span>
  {#if showBar}
    <div
      class="speed-bar"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={SPEED_BAR_MAX_MBPS}
      aria-valuenow={mbps ?? 0}
      aria-label={`${label} speed`}
    >
      <div class="speed-bar-track">
        <div class="speed-bar-fill" style:width={`${fillPercent}%`}></div>
      </div>
      <div class="speed-bar-scale" aria-hidden="true">
        <span>0</span>
        <span>{SPEED_BAR_MAX_MBPS} Mbps</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .speed-metric-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .speed-metric-tile[data-active="true"] .stat-value {
    color: var(--color-accent);
  }

  .speed-bar {
    margin-top: var(--space-1);
  }

  .speed-bar-track {
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-border);
    overflow: hidden;
  }

  .speed-bar-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    transition: width 200ms ease;
  }

  .speed-bar-scale {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
