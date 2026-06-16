<script lang="ts">
  import { formatMs, formatPercent } from "../lib/status";

  let {
    latency,
    jitter,
    lossPercent,
  }: {
    latency?: number;
    jitter?: number;
    lossPercent?: number;
  } = $props();
</script>

<section class="card live-metrics">
  <h2>Live (60s)</h2>
  <div class="metrics-grid">
    <div>
      <span class="label">Latency</span>
      <span class="value">{formatMs(latency)}</span>
    </div>
    <div>
      <span class="label">Jitter</span>
      <span class="value">{formatMs(jitter)}</span>
    </div>
    <div>
      <span class="label">Loss</span>
      <span class="value">{lossPercent != null ? formatPercent(lossPercent) : "—"}</span>
    </div>
  </div>
</section>
