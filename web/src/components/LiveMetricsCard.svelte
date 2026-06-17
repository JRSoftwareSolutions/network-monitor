<script lang="ts">
  import LiveMetrics from "./LiveMetrics.svelte";
  import { getLive, type LiveMetrics as LiveMetricsType, type Thresholds } from "../lib/api";
  import { adoptConnectionSample } from "../lib/connectionSample";
  import { subscribeLiveRefresh } from "../lib/liveRefresh";
  import { DASHBOARD_METRICS } from "../lib/windows";

  let {
    thresholds,
  }: {
    thresholds?: Thresholds;
  } = $props();

  let live = $state<LiveMetricsType | null>(null);
  let loadSeq = 0;

  async function loadLive() {
    const seq = ++loadSeq;
    const data = await getLive();
    if (seq !== loadSeq) return;
    live = data;
    if (data.last_ts) {
      adoptConnectionSample(data.last_ts, data.last_success);
    }
  }

  $effect(() => {
    void loadLive();
  });

  $effect(() => {
    return subscribeLiveRefresh(() => void loadLive());
  });
</script>

<LiveMetrics
  title={DASHBOARD_METRICS.live.title(0)}
  {thresholds}
  latency={live?.latency_ms}
  minLatency={live?.min_latency_ms}
  maxLatency={live?.max_latency_ms}
  jitter={live?.jitter_ms}
  minJitter={live?.min_jitter_ms}
  maxJitter={live?.max_jitter_ms}
  lossPercent={live?.loss_percent}
  sampleCount={live?.sample_count}
  successCount={live?.success_count}
/>
