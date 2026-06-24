<script lang="ts">
  import SpeedMetricTile from "./SpeedMetricTile.svelte";
  import { getSpeedTestResults, getSpeedTestStatus, runSpeedTest, type SpeedTestResult } from "../lib/api";
  import { formatMbps } from "../lib/status";
  import { subscribeSpeedTestProgress } from "../lib/speedtestProgress";
  import { formatShortTime } from "../lib/time";

  const HISTORY_LIMIT = 5;

  let running = $state(false);
  let result = $state<SpeedTestResult | null>(null);
  let errorText = $state("");
  let liveDownloadMbps = $state(0);
  let liveUploadMbps = $state(0);
  let livePhase = $state<"download" | "upload" | null>(null);
  let history = $state<SpeedTestResult[]>([]);

  const cardState = $derived(
    errorText ? "error" : running ? "running" : result ? "complete" : "idle",
  );

  const downloadMbps = $derived(running ? liveDownloadMbps : result?.download_mbps ?? null);
  const uploadMbps = $derived(running ? liveUploadMbps : result?.upload_mbps ?? null);

  const downloadActive = $derived(running && livePhase !== "upload");
  const uploadActive = $derived(running && livePhase === "upload");

  async function syncRunningState() {
    try {
      const status = await getSpeedTestStatus();
      running = status.running;
    } catch {
      // keep current state on transient errors
    }
  }

  async function loadHistory() {
    try {
      const data = await getSpeedTestResults(HISTORY_LIMIT);
      history = data.results;
    } catch {
      // keep prior history on transient errors
    }
  }

  $effect(() => {
    void loadHistory();
    void syncRunningState();
  });

  $effect(() => {
    return subscribeSpeedTestProgress((progress) => {
      livePhase = progress.phase;
      if (progress.phase === "download") {
        liveDownloadMbps = progress.mbps;
      } else {
        liveUploadMbps = progress.mbps;
      }
    });
  });

  async function onRun() {
    running = true;
    errorText = "";
    result = null;
    liveDownloadMbps = 0;
    liveUploadMbps = 0;
    livePhase = null;
    try {
      const res = await runSpeedTest();
      result = res;
      if (res.error) {
        errorText = res.error;
      }
      await loadHistory();
    } catch (err) {
      errorText = err instanceof Error ? err.message : "Speed test failed";
    } finally {
      running = false;
    }
  }
</script>

<section class="card dashboard-panel speed-test" data-state={cardState}>
  <div class="header-row">
    <h2>Speed test</h2>
    <button type="button" disabled={running} onclick={() => void onRun()}>
      {running ? "Running…" : "Run test"}
    </button>
  </div>

  {#if cardState === "idle"}
    <p class="hint">On-demand download and upload snapshot from this host.</p>
  {:else if running}
    <p class="hint">Test in progress — live speeds update below.</p>
  {/if}

  <div class="speed-metrics">
    <SpeedMetricTile
      label="Download"
      mbps={downloadMbps}
      active={downloadActive}
      showBar={downloadActive}
    />
    <SpeedMetricTile
      label="Upload"
      mbps={uploadMbps}
      active={uploadActive}
      showBar={uploadActive}
    />
  </div>

  {#if errorText}
    <p class="error" role="alert">{errorText}</p>
  {/if}

  {#if history.length > 0}
    <div class="history">
      <h3 class="history-title">Recent</h3>
      <ul class="history-list">
        {#each history as entry (entry.id ?? entry.ts)}
          <li class="history-row" data-has-error={entry.error ? "true" : "false"}>
            <span class="history-time">{formatShortTime(entry.ts)}</span>
            <span class="history-speeds">
              <span>↓ {formatMbps(entry.download_mbps)}</span>
              <span>↑ {formatMbps(entry.upload_mbps)}</span>
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .header-row h2 {
    margin: 0;
  }

  .hint {
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .speed-metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .error {
    margin: var(--space-2) 0 0;
    color: var(--color-status-poor);
    font-size: var(--text-sm);
  }

  .history {
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-2);
  }

  .history-title {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .history-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .history-row[data-has-error="true"] .history-speeds {
    color: var(--color-status-poor);
  }

  .history-time {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }

  .history-speeds {
    display: flex;
    gap: var(--space-3);
    font-variant-numeric: tabular-nums;
  }
</style>
