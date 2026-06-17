<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ConnectionStatusCard from "./components/ConnectionStatusCard.svelte";
  import ChartPanel from "./components/ChartPanel.svelte";
  import LiveMetricsCard from "./components/LiveMetricsCard.svelte";
  import ConnectionPill from "./components/ConnectionPill.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import {
    getConfig,
    putConfig,
    type AppConfig,
    type Sample,
  } from "./lib/api";
  import { SSEClient } from "./lib/sse";
  import { publishChartSample, requestChartReload } from "./lib/chartSample";
  import { adoptConnectionSample } from "./lib/connectionSample";
  import { requestLiveRefresh } from "./lib/liveRefresh";
  import { loadWindowMinutes, saveWindowMinutes } from "./lib/preferences";

  let config = $state<AppConfig | null>(null);
  let windowMinutes = $state(30);
  let settingsOpen = $state(false);
  let saving = $state(false);
  let settingsError = $state("");

  let sse: SSEClient | null = null;

  async function bootstrap() {
    config = await getConfig();
    if (config.window_options_minutes.length > 0) {
      const preferred = config.window_options_minutes.includes(30)
        ? 30
        : config.window_options_minutes[config.window_options_minutes.length - 1];
      windowMinutes = loadWindowMinutes(config.window_options_minutes, preferred);
    }
    requestLiveRefresh();
  }

  function handleSSE(type: string, data: unknown) {
    if (type === "sample") {
      const sample = data as Sample;
      adoptConnectionSample(sample.ts, sample.success);
      publishChartSample(sample, windowMinutes);
      requestLiveRefresh();
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
      requestChartReload(windowMinutes);
      requestLiveRefresh();
    } catch (err) {
      settingsError = err instanceof Error ? err.message : "Save failed";
    } finally {
      saving = false;
    }
  }

  async function onWindowChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    windowMinutes = Number(select.value);
    saveWindowMinutes(windowMinutes);
  }

  onMount(() => {
    void (async () => {
      await bootstrap();
      sse = new SSEClient(handleSSE, () => {
        requestChartReload(windowMinutes);
        requestLiveRefresh();
      });
      sse.connect();
    })();
  });

  onDestroy(() => {
    sse?.close();
  });

  const lanHint = $derived(config?.listen_host === "0.0.0.0");
  const pingIntervalMs = $derived((config?.ping_interval_seconds ?? 1) * 1000);
</script>

<div class="page-shell">
<div class="page">
  <header class="topbar">
    <div>
      <h1>Network Monitor</h1>
      <p class="sub">
        Target <strong>{config?.target ?? "…"}</strong>
      </p>
    </div>
    <div class="topbar-actions">
      <ConnectionPill pingIntervalMs={pingIntervalMs} />
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

  <main class="dashboard-grid">
    <ConnectionStatusCard {windowMinutes} thresholds={config?.thresholds} />
    <LiveMetricsCard thresholds={config?.thresholds} />
    <ChartPanel {windowMinutes} />
  </main>
</div>
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
