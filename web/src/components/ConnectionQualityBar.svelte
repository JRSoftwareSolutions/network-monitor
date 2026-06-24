<script lang="ts">
  import type { StatusTier } from "../lib/status";
  import { tierLabel } from "../lib/status";

  let {
    quality = 100,
    status = "offline" as StatusTier,
  }: {
    quality?: number;
    status?: StatusTier;
  } = $props();
</script>

<div
  class="quality-meter"
  role="meter"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={quality}
  aria-label={tierLabel(status)}
>
  <div class="track"></div>
  <div class="needle" style:left={`${quality}%`}></div>
</div>

<style>
  .quality-meter {
    position: relative;
    margin: 0 0 var(--space-4);
  }

  .track {
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--gradient-quality-bar);
  }

  .needle {
    position: absolute;
    top: -5px;
    width: 6px;
    height: calc(100% + 10px);
    box-sizing: border-box;
    background: var(--color-quality-needle);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    transform: translateX(-50%);
    transition: left 300ms ease;
    pointer-events: none;
  }
</style>
