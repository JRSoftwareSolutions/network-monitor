<script lang="ts">
  import type { StatusTier } from "../lib/status";
  import { tierLabel } from "../lib/status";

  let {
    status = "offline" as StatusTier,
    avgLatency,
    lossPercent,
  }: {
    status?: StatusTier;
    avgLatency?: number;
    lossPercent?: number;
  } = $props();
</script>

<section class="card status-card" data-status={status}>
  <h2>Connection</h2>
  <p class="tier">{tierLabel(status)}</p>
  <dl>
    <div>
      <dt>Avg latency</dt>
      <dd>{avgLatency != null ? `${avgLatency.toFixed(1)} ms` : "—"}</dd>
    </div>
    <div>
      <dt>Packet loss</dt>
      <dd>{lossPercent != null ? `${lossPercent.toFixed(1)}%` : "—"}</dd>
    </div>
  </dl>
</section>
