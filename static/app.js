/* ---------- data fetching ---------- */

async function fetchConnection() {
  const response = await fetch("/api/connection");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchMetrics(knownTs = null) {
  const params = new URLSearchParams({ windowMinutes: String(getWindowMinutes()) });
  if (knownTs) {
    params.set("knownTs", knownTs);
  }
  const response = await fetch(`/api/metrics?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchMetricsLive(knownTs = null) {
  const url = knownTs
    ? `/api/metrics/live?knownTs=${encodeURIComponent(knownTs)}`
    : "/api/metrics/live";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function applyLiveMetrics(payload) {
  const { recent_samples: recentSamples, now } = payload;

  if (!isHistoryView()) {
    updateHero(now);
  }
  updateStatusPanel(now);
  updateIndicators(now);
  updateLiveFeed(now, recentSamples);
  if (!isHistoryView()) {
    updateRecentTable(recentSamples);
  }

  lastUpdatedAt = Date.now();
  updateStalenessIndicator();

  statusText.textContent = recentSamples?.length ? "Live" : "Waiting for data…";
  statusIndicator.className = recentSamples?.length ? "status live" : "status";
}

function applyMetrics(payload) {
  lastMetricsPayload = payload;

  const {
    samples,
    recent_samples: recentSamples,
    stats,
    blocks,
    health,
    now,
    outages,
    window_minutes: windowMinutes,
  } = payload;

  const windowMins = windowMinutes ?? getWindowMinutes();
  if (!needsHistoryVisualizations()) {
    blocksPanelTitle.textContent = `Latency blocks (last ${windowMins} min)`;
    if (blocksPanelSubtitle) {
      blocksPanelSubtitle.textContent =
        "1-minute candles — green is good, amber is fair, red is poor (latency + jitter + loss)";
    }
  }
  windowLabel.textContent = String(windowMins);

  if (needsHistoryVisualizations()) {
    applyHistoryVisualizations(payload);
  } else {
    updateHero(now);
  }
  updateStatusPanel(now);
  updateIndicators(now);
  updateLiveFeed(now, recentSamples ?? samples);
  updateSummaryCards(stats);
  updateHealthChip(health, stats);
  updateBlocksChart(blocks, windowMins, payload.latest_ts);
  updateCharts(samples, windowMins, payload.latest_ts, outages);
  updateLossChart(blocks, windowMins, payload.latest_ts);
  if (isHistoryView()) {
    updateRecentTable(recentSamples ?? samples, { limit: HISTORY_RECENT_LIMIT });
  } else {
    updateRecentTable(recentSamples ?? samples);
  }
  updateOutagesTable(outages);

  lastUpdatedAt = Date.now();
  updateStalenessIndicator();

  statusText.textContent = samples.length ? "Live" : "Waiting for data…";
  statusIndicator.className = samples.length ? "status live" : "status";
  lastFullRefreshAt = Date.now();
}

async function refreshConnection() {
  try {
    const connection = await fetchConnection();
    connectionLabel.textContent = formatConnection(connection);
  } catch (error) {
    console.error("Failed to refresh connection info", error);
  }
}

async function poll(forceFull = false) {
  try {
    if (document.hidden && !forceFull) {
      // Tab in background: cheap heartbeat only, no DOM or chart work.
      // The forced refresh on visibilitychange repaints everything.
      const live = await fetchMetricsLive(lastSampleTs);
      if (!live.unchanged && live.latest_ts) {
        lastSampleTs = live.latest_ts;
      }
      return;
    }

    const needsFullRefresh =
      forceFull ||
      !lastFullRefreshAt ||
      Date.now() - lastFullRefreshAt >= FULL_REFRESH_MS;

    if (needsFullRefresh) {
      // forceFull means the window may have changed, so knownTs must not
      // short-circuit the response.
      const payload = await fetchMetrics(forceFull ? null : lastSampleTs);
      if (payload.unchanged) {
        lastFullRefreshAt = Date.now();
        return;
      }
      lastSampleTs = payload.latest_ts ?? null;
      applyMetrics(payload);
      return;
    }

    const live = await fetchMetricsLive(lastSampleTs);
    if (live.unchanged) {
      return;
    }
    lastSampleTs = live.latest_ts ?? null;
    applyLiveMetrics(live);
  } catch (error) {
    statusText.textContent = "Connection error";
    statusIndicator.className = "status error";
    console.error(error);
  }
}

function getPollIntervalMs() {
  if (document.hidden) {
    return pollIntervalMs * HIDDEN_POLL_MULTIPLIER;
  }
  return pollIntervalMs;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await poll(false);
    schedulePoll();
  }, getPollIntervalMs());
}

function scheduleConnectionRefresh() {
  clearTimeout(connectionTimer);
  connectionTimer = setTimeout(async () => {
    await refreshConnection();
    scheduleConnectionRefresh();
  }, CONNECTION_REFRESH_MS);
}

function startStalenessTimer() {
  clearInterval(stalenessTimer);
  stalenessTimer = setInterval(updateStalenessIndicator, 1000);
}

function stopStalenessTimer() {
  clearInterval(stalenessTimer);
  stalenessTimer = null;
}

/* ---------- dashboard views (ViewBuilder integration) ---------- */

function resizeCharts() {
  latencyChart?.resize();
  jitterChart?.resize();
  lossChart?.resize();
  latencyBlocksChart?.resize();
  distributionChart?.resize();
  historyLatencyPie?.resize();
  historyJitterPie?.resize();
  historyLossPie?.resize();
  historyQualityPie?.resize();
}

function resetHeroLiveChrome() {
  if (heroKicker) {
    for (const node of heroKicker.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent = "connection status";
        break;
      }
    }
  }
  if (readoutCaption) {
    readoutCaption.innerHTML =
      'baseline ping <span class="readout-hint">60s median — single spikes can\'t move it</span>';
  }
  verdictDetailLive.hidden = false;
  windowSummaryDetail.hidden = true;
}

function nudgeChartsAfterLayout() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resizeCharts();
    });
  });
}

function handleViewApplied({ view }) {
  hero.classList.toggle("hero--window-summary", view === "history");
  if (view === "history") {
    verdictDetailLive.hidden = true;
    windowSummaryDetail.hidden = false;
  } else {
    resetHeroLiveChrome();
  }

  if (needsHistoryVisualizations(view) && lastMetricsPayload) {
    applyHistoryVisualizations(lastMetricsPayload);
  } else if (!isHistoryView()) {
    const latencyPanelTitle = document.querySelector('[data-panel="latency"] h2');
    if (latencyPanelTitle) {
      latencyPanelTitle.textContent = "Latency";
    }
    if (lastMetricsPayload?.now) {
      updateHero(lastMetricsPayload.now);
    }
    if (lastMetricsPayload) {
      const windowMins = lastMetricsPayload.window_minutes ?? getWindowMinutes();
      if (blocksPanelTitle) {
        blocksPanelTitle.textContent = `Latency blocks (last ${windowMins} min)`;
      }
      if (blocksPanelSubtitle) {
        blocksPanelSubtitle.textContent =
          "1-minute candles — green is good, amber is fair, red is poor (latency + jitter + loss)";
      }
    }
  }

  nudgeChartsAfterLayout();
}

function initDashboardView() {
  ViewBuilder.init({
    viewSelect,
    onViewApplied: handleViewApplied,
  });
  ViewBuilder.onLayoutChange(() => {
    if (needsHistoryVisualizations() && lastMetricsPayload) {
      applyHistoryVisualizations(lastMetricsPayload);
    }
    nudgeChartsAfterLayout();
  });
}


/* ---------- settings popover ---------- */

/* Globally anycast resolvers with high availability — good proxies for
   "is my internet connection healthy". The backend accepts any host/IP. */
const TARGET_PRESETS = [
  { label: "Cloudflare DNS", host: "1.1.1.1" },
  { label: "Google DNS", host: "8.8.8.8" },
  { label: "Quad9 DNS", host: "9.9.9.9" },
  { label: "OpenDNS", host: "208.67.222.222" },
];
const CUSTOM_TARGET_VALUE = "__custom__";

const settingsToggle = document.getElementById("settings-toggle");
const settingsPopover = document.getElementById("settings-popover");
const settingsPanel = settingsPopover?.querySelector(".settings-popover__panel");
const settingsBackdrop = settingsPopover?.querySelector(".settings-popover__backdrop");
const settingsForm = document.getElementById("settings-form");
const settingsClose = document.getElementById("settings-close");
const settingsCancel = document.getElementById("settings-cancel");
const settingsSave = document.getElementById("settings-save");
const settingsError = document.getElementById("settings-error");
const targetPresetSelect = document.getElementById("settings-target-preset");
const targetCustomField = document.getElementById("settings-custom-target-field");
const targetCustomInput = document.getElementById("settings-target-custom");
const settingsInputs = {
  pingInterval: document.getElementById("settings-ping-interval"),
  fullRefresh: document.getElementById("settings-full-refresh"),
  connectionRefresh: document.getElementById("settings-connection-refresh"),
  hiddenMultiplier: document.getElementById("settings-hidden-multiplier"),
  logAge: document.getElementById("settings-log-age"),
};

/* Apply a /api/config payload to the UI and all polling timers. Used at
   bootstrap and after saving settings — the timer chains read these values
   on every cycle, so updates take effect without a reload. */
function applyConfigPayload(config) {
  currentConfig = config;
  targetLabel.textContent = config.target;
  populateWindowOptions(config.window_options ?? [5, 15, 30, 60, 120], config.default_window_minutes);
  pollIntervalMs = Math.max(250, config.ping_interval_seconds * 1000);
  if (config.full_refresh_seconds != null) {
    FULL_REFRESH_MS = config.full_refresh_seconds * 1000;
  }
  if (config.connection_refresh_seconds != null) {
    CONNECTION_REFRESH_MS = config.connection_refresh_seconds * 1000;
  }
  if (config.hidden_poll_multiplier != null) {
    HIDDEN_POLL_MULTIPLIER = config.hidden_poll_multiplier;
  }
}

function populateTargetPresets() {
  targetPresetSelect.innerHTML = "";
  for (const preset of TARGET_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.host;
    option.textContent = `${preset.label} — ${preset.host}`;
    targetPresetSelect.appendChild(option);
  }
  const custom = document.createElement("option");
  custom.value = CUSTOM_TARGET_VALUE;
  custom.textContent = "Custom…";
  targetPresetSelect.appendChild(custom);
}

function syncCustomTargetVisibility() {
  targetCustomField.hidden = targetPresetSelect.value !== CUSTOM_TARGET_VALUE;
}

function positionSettingsPanel() {
  positionFloatingPanel(settingsToggle, settingsPanel, { hAlign: "right", flipVertical: false });
}

function showSettingsError(message) {
  settingsError.textContent = message ?? "";
  settingsError.hidden = !message;
}

function populateSettingsForm() {
  const config = currentConfig ?? {};
  const target = config.target ?? "";
  const preset = TARGET_PRESETS.find((entry) => entry.host === target);
  targetPresetSelect.value = preset ? preset.host : CUSTOM_TARGET_VALUE;
  targetCustomInput.value = preset ? "" : target;
  syncCustomTargetVisibility();
  ViewBuilder.updateSettingsLayoutSummary();

  settingsInputs.pingInterval.value = String(config.ping_interval_seconds ?? pollIntervalMs / 1000);
  settingsInputs.fullRefresh.value = String(config.full_refresh_seconds ?? FULL_REFRESH_MS / 1000);
  settingsInputs.connectionRefresh.value = String(
    config.connection_refresh_seconds ?? CONNECTION_REFRESH_MS / 1000,
  );
  settingsInputs.hiddenMultiplier.value = String(config.hidden_poll_multiplier ?? HIDDEN_POLL_MULTIPLIER);
  settingsInputs.logAge.value = String(config.max_log_age_minutes ?? 180);
}

function openSettings() {
  populateSettingsForm();
  showSettingsError("");
  settingsPopover.hidden = false;
  settingsToggle.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => positionSettingsPanel());
  });
}

function closeSettings() {
  if (settingsPopover.hidden) return;
  settingsPopover.hidden = true;
  settingsToggle.setAttribute("aria-expanded", "false");
}

function readSettingsNumber(input, label, errors) {
  const value = Number(input.value);
  if (input.value.trim() === "" || !Number.isFinite(value)) {
    errors.push(`${label} must be a number`);
    return null;
  }
  const min = Number(input.min);
  const max = Number(input.max);
  if (value < min || value > max) {
    errors.push(`${label} must be between ${min} and ${max}`);
    return null;
  }
  return value;
}

function collectSettingsPayload() {
  const errors = [];

  let target = targetPresetSelect.value;
  if (target === CUSTOM_TARGET_VALUE) {
    target = targetCustomInput.value.trim();
    if (!target) {
      errors.push("Custom target must not be empty");
    }
  }

  const pingInterval = readSettingsNumber(settingsInputs.pingInterval, "Ping interval", errors);
  const fullRefresh = readSettingsNumber(settingsInputs.fullRefresh, "Graph refresh", errors);
  const connectionRefresh = readSettingsNumber(
    settingsInputs.connectionRefresh,
    "Connection info refresh",
    errors,
  );
  const hiddenMultiplier = readSettingsNumber(
    settingsInputs.hiddenMultiplier,
    "Hidden-tab slowdown",
    errors,
  );
  const logAge = readSettingsNumber(settingsInputs.logAge, "History kept", errors);

  if (errors.length) {
    showSettingsError(errors[0]);
    return null;
  }

  return {
    target,
    ping_interval_seconds: pingInterval,
    full_refresh_seconds: fullRefresh,
    connection_refresh_seconds: connectionRefresh,
    hidden_poll_multiplier: Math.round(hiddenMultiplier),
    max_log_age_minutes: Math.round(logAge),
  };
}

function formatSaveError(status, body) {
  const detail = body?.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail) && detail.length) {
    const item = detail[0];
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "";
    const message = String(item.msg ?? "invalid value").replace(/^Value error,\s*/, "");
    return field ? `${field}: ${message}` : message;
  }
  return `Save failed (HTTP ${status})`;
}

async function saveSettings(event) {
  event.preventDefault();
  const payload = collectSettingsPayload();
  if (!payload) return;

  showSettingsError("");
  settingsSave.disabled = true;
  settingsSave.textContent = "Saving…";
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        /* non-JSON error body */
      }
      showSettingsError(formatSaveError(response.status, body));
      return;
    }

    applyConfigPayload(await response.json());
    scheduleConnectionRefresh();
    closeSettings();
    poll(true);
  } catch (error) {
    console.error("Failed to save settings", error);
    showSettingsError("Could not reach the server — settings not saved");
  } finally {
    settingsSave.disabled = false;
    settingsSave.textContent = "Save";
  }
}

function initSettings() {
  if (!settingsToggle || !settingsPopover) return;

  populateTargetPresets();
  settingsToggle.addEventListener("click", openSettings);
  targetPresetSelect.addEventListener("change", () => {
    syncCustomTargetVisibility();
    positionSettingsPanel();
    if (!targetCustomField.hidden) {
      targetCustomInput.focus();
    }
  });
  settingsForm.addEventListener("submit", saveSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsCancel.addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);
  document.getElementById("settings-open-layout")?.addEventListener("click", () => {
    closeSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const layoutDialog = document.getElementById("layout-dialog");
    if (layoutDialog && !layoutDialog.hidden) return;
    closeSettings();
  });
  window.addEventListener("resize", () => {
    if (!settingsPopover.hidden) positionSettingsPanel();
  });
}

async function bootstrap() {
  initHeartbeat();
  try {
    initDashboardView();
  } catch (error) {
    console.error("Dashboard view setup failed — live metrics will still load", error);
  }
  initScreenshot();
  initSettings();
  initHelpPopovers();

  try {
    initCharts();
  } catch (error) {
    console.error("Chart setup failed — live metrics will still load", error);
  }

  try {
    const configResponse = await fetch("/api/config");
    if (configResponse.ok) {
      applyConfigPayload(await configResponse.json());
    }
  } catch (error) {
    console.error("Failed to load config", error);
    populateWindowOptions([5, 15, 30, 60, 120], 30);
  }

  windowSelect.addEventListener("change", () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, windowSelect.value);
    poll(true);
  });

  await Promise.all([poll(true), refreshConnection()]);
  schedulePoll();
  scheduleConnectionRefresh();
  if (!document.hidden) {
    startStalenessTimer();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopStalenessTimer();
  } else {
    startStalenessTimer();
    updateStalenessIndicator();
    poll(true);
  }
  schedulePoll();
});

bootstrap();
