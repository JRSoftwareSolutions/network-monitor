<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import StatusCard from "./components/StatusCard.svelte";
  import LiveMetrics from "./components/LiveMetrics.svelte";
  import LatencyChart from "./components/LatencyChart.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import {
    getConfig,
    getSummary,
    getSamples,
    getLive,
    putConfig,
    type AppConfig,
    type Sample,
    type Summary,
    type LiveMetrics as LiveMetricsType,
  } from "./lib/api";
  import { SSEClient, filterSamplesByWindow } from "./lib/sse";
  import { connectionState } from "./lib/status";

  let config = $state<AppConfig | null>(null);
  let summary = $state<Summary | null>(null);
  let live = $state<LiveMetricsType | null>(null);
  let samples = $state<Sample[]>([]);
  let windowMinutes = $state(30);
  let lastTs = $state<string | null>(null);
  let settingsOpen = $state(false);
  let saving = $state(false);
  let settingsError = $state("");
  let now = $state(Date.now());

  let sse: SSEClient | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshWindow() {
    const [summaryRes, samplesRes, liveRes] = await Promise.all([
      getSummary(windowMinutes),
      getSamples(windowMinutes),
      getLive(),
    ]);
    summary = summaryRes;
    samples = samplesRes.samples;
    live = liveRes;
    if (samples.length > 0) {
      lastTs = samples[samples.length - 1].ts;
    }
  }

  async function bootstrap() {
    config = await getConfig();
    if (config.window_options_minutes.length > 0) {
      const preferred = config.window_options_minutes.includes(30)
        ? 30
        : config.window_options_minutes[config.window_options_minutes.length - 1];
      windowMinutes = preferred;
    }
    await refreshWindow();
  }

  function handleSSE(type: string, data: unknown) {
    if (type === "sample") {
      const sample = data as Sample;
      lastTs = sample.ts;
      samples = [...samples, sample];
      samples = filterSamplesByWindow(samples, windowMinutes);
      void getLive().then((res) => (live = res));
      void getSummary(windowMinutes).then((res) => (summary = res));
    }
    if (type === "config") {
      const patch = data as Partial<AppConfig>;
      if (config) {
        config = { ...config, ...patch };
      }
    }
  }

  async function saveSettings(values: {
    target: string;
    ping_interval_seconds: number;
    retention_minutes: number;
  }) {
    saving = true;
    settingsError = "";
    try {
      await putConfig(values);
      config = await getConfig();
      settingsOpen = false;
      await refreshWindow();
    } catch (err) {
      settingsError = err instanceof Error ? err.message : "Save failed";
    } finally {
      saving = false;
    }
  }

  async function onWindowChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    windowMinutes = Number(select.value);
    await refreshWindow();
  }

  onMount(() => {
    void bootstrap();
    sse = new SSEClient(handleSSE);
    sse.connect();
    clockTimer = setInterval(() => {
      now = Date.now();
    }, 1000);
  });

  onDestroy(() => {
    sse?.close();
    if (clockTimer) clearInterval(clockTimer);
  });

  const conn = $derived(
    connectionState(lastTs, (config?.ping_interval_seconds ?? 1) * 1000 * 3),
  );
  const lastAgeSec = $derived(lastTs ? Math.max(0, Math.floor((now - Date.parse(lastTs)) / 1000)) : null);
  const lanHint = $derived(config?.listen_host === "0.0.0.0");
</script>

<div class="page">
  <header class="topbar">
    <div>
      <h1>Network Monitor</h1>
      <p class="sub">
        Target <strong>{config?.target ?? "…"}</strong>
        {#if lastAgeSec != null}
          · updated {lastAgeSec}s ago
        {/if}
      </p>
    </div>
    <div class="topbar-actions">
      <span class="pill" data-state={conn}>{conn}</span>
      {#if lanHint}
        <span class="pill lan">LAN mode</span>
      {/if}
      <label class="window-select">
        Window
        <select value={windowMinutes} onchange={onWindowChange}>
          {#each config?.window_options_minutes ?? [5, 15, 30, 60] as minutes}
            <option value={minutes}>{minutes} min</option>
          {/each}
        </select>
      </label>
      <button type="button" onclick={() => (settingsOpen = true)}>Settings</button>
    </div>
  </header>

  <main class="grid">
    <StatusCard
      status={summary?.status ?? "offline"}
      avgLatency={summary?.avg_latency_ms}
      lossPercent={summary?.loss_percent}
    />
    <LiveMetrics
      latency={live?.latency_ms}
      jitter={live?.jitter_ms}
      lossPercent={live?.loss_percent}
    />
    <div class="chart-span">
      <LatencyChart {samples} />
    </div>
  </main>
</div>

<SettingsPanel
  open={settingsOpen}
  target={config?.target ?? "1.1.1.1"}
  pingInterval={config?.ping_interval_seconds ?? 1}
  retention={config?.retention_minutes ?? 180}
  {saving}
  error={settingsError}
  onclose={() => (settingsOpen = false)}
  onsave={saveSettings}
/>
