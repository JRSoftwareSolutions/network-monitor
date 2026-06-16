/* =====================================================================
   Network Monitor - dashboard orchestration
   ===================================================================== */
(function () {
  "use strict";

  const F = window.DashboardFormat;
  const DR = window.DashboardRender;
  const DC = window.DashboardCharts;
  const Sync = window.DashboardMetricsSync;
  const { dash, agoText, $, setText } = F;

  const TARGET_PRESETS = [
    { label: "Cloudflare DNS", host: "1.1.1.1" },
    { label: "Google DNS", host: "8.8.8.8" },
    { label: "Quad9 DNS", host: "9.9.9.9" },
    { label: "OpenDNS", host: "208.67.222.222" },
  ];
  const CUSTOM = "__custom__";

  const state = {
    windowMinutes: 30,
    lastSampleTs: null,
    lastNow: null,
    lastUpdatedAt: 0,
    lastChartDataAt: 0,
    lastHiddenAt: 0,
    lastMetricsPayload: null,
    config: null,
    sparklineNow: null,
    indicatorSeries: null,
    heartbeatSamples: [],
    pollIntervalMs: 1000,
    connRefreshMs: 120000,
    activateTimer: null,
    connTimer: null,
    stalenessTimer: null,
  };

  DR.bindState(state);

  function setStatusPill(stateName, text) {
    const pill = $("status-pill");
    if (pill) pill.dataset.state = stateName;
    setText("status-text", text);
  }

  function updateStaleness() {
    if (!state.lastUpdatedAt) { setText("updated-pill", dash); return; }
    setText("updated-pill", agoText(Date.now() - state.lastUpdatedAt));
  }

  function recentSamples(payload) {
    return payload.recent_samples || payload.samples || [];
  }

  function renderLiveSections(payload) {
    const now = payload.now || {};
    const samples = recentSamples(payload);
    state.sparklineNow = now;
    state.indicatorSeries = payload.indicator_series || null;
    DR.renderHero(now);
    DR.renderStatus(now);
    DR.renderIndicators(now);
    DR.renderLive(now, samples);
    DR.renderNarrative(now);
    DR.updateIndicatorSparklines(now, payload.indicator_series);
  }

  function renderGraphPanels(payload) {
    setText("window-label", String(payload.window_minutes ?? state.windowMinutes));
    DR.renderStats(payload.stats);
    DR.renderHealth(payload.health);
    DR.renderOutages(payload.outages);
    DR.renderRecent(recentSamples(payload));
  }

  /** Sole path that touches Chart.js canvases and graph DOM panels. */
  function paintGraphs({ waitForLayout = false } = {}) {
    const payload = state.lastMetricsPayload;
    if (!payload) return;

    const draw = () => {
      DC.resizeCharts();
      DC.updateCharts(payload);
      DR.renderTimeline(payload.blocks);
      DR.renderBlocksChart(payload.blocks);
      DC.redrawCharts();
      DR.updateIndicatorSparklines(state.sparklineNow, state.indicatorSeries);
    };

    if (waitForLayout) {
      DC.layoutSettledRefresh(draw);
    } else {
      draw();
    }
  }

  /** Sole entry point for metrics sync (full payload or unchanged tick). */
  function ingestMetrics(payload) {
    if (payload.unchanged) {
      state.lastUpdatedAt = Date.now();
      updateStaleness();
      if (payload.now?.display_verdict && state.lastNow) {
        DR.renderHero({ ...state.lastNow, display_verdict: payload.now.display_verdict });
      }
      return;
    }

    state.lastMetricsPayload = payload;
    if (payload.now) state.lastNow = payload.now;
    if (payload.latest_ts) state.lastSampleTs = payload.latest_ts;
    state.lastUpdatedAt = Date.now();
    state.lastChartDataAt = Date.now();

    renderLiveSections(payload);
    renderGraphPanels(payload);
    updateStaleness();
    const has = Boolean(recentSamples(payload).length || (payload.samples || []).length);
    setStatusPill(has ? "live" : "waiting", has ? "Live" : "Waiting for data...");

    paintGraphs();
  }

  async function refreshConnection() {
    try {
      const c = await fetchJson("/api/connection");
      let label = "Unknown connection";
      if (c.type && c.name) label = `${c.type} · ${c.name}`;
      else if (c.type) label = c.type;
      else if (c.name) label = c.name;
      setText("connection-label", label);
    } catch (err) {
      console.error("connection refresh failed", err);
    }
  }

  async function fetchJson(url, options = {}) {
    const timeoutMs = 10000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    const outerSignal = options.signal;
    const onOuterAbort = () => timeoutController.abort();
    if (outerSignal) {
      if (outerSignal.aborted) {
        clearTimeout(timeoutId);
        throw new DOMException("Aborted", "AbortError");
      }
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }
    try {
      const res = await fetch(url, { ...options, signal: timeoutController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timeoutId);
      if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }

  function scheduleConnection() {
    clearTimeout(state.connTimer);
    state.connTimer = setTimeout(async () => { await refreshConnection(); scheduleConnection(); }, state.connRefreshMs);
  }

  function populateWindowOptions(options, selected) {
    const select = $("window-select");
    select.innerHTML = "";
    const stored = Number(localStorage.getItem(ViewsModel.STORAGE_KEYS.windowMinutes));
    const value = stored && options.includes(stored) ? stored : selected;
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = String(opt);
      o.textContent = `${opt} min`;
      select.appendChild(o);
    }
    select.value = String(value);
    state.windowMinutes = value;
  }

  function applyConfig(config) {
    const prevTarget = state.config?.target;
    state.config = config;
    if (config.target !== prevTarget) state.lastSampleTs = null;
    if (window.DashboardRating && config.gaming_thresholds) {
      window.DashboardRating.applyThresholds(config.gaming_thresholds);
    }
    window.DashboardRating?.updateHeartbeatLegend($("hb-legend"));
    setText("target-label", config.target || dash);
    populateWindowOptions(config.window_options && config.window_options.length ? config.window_options : [5, 15, 30, 60, 120], config.default_window_minutes || 30);
    state.pollIntervalMs = Math.max(250, (config.ping_interval_seconds || 1) * 1000);
    if (config.connection_refresh_seconds != null) state.connRefreshMs = config.connection_refresh_seconds * 1000;
    scheduleConnection();
  }

  function parseConfigError(res, body) {
    let detail = `Save failed (HTTP ${res.status})`;
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]) {
      return String(body.detail[0].msg || detail).replace(/^Value error,\s*/, "");
    }
    return detail;
  }

  function initSettings() {
    const modal = $("settings-modal");
    const presetSelect = $("set-target-preset");
    const customRow = $("set-custom-row");
    const customInput = $("set-target-custom");
    const errorEl = $("settings-error");

    presetSelect.innerHTML = "";
    for (const p of TARGET_PRESETS) {
      const o = document.createElement("option");
      o.value = p.host; o.textContent = `${p.label} - ${p.host}`;
      presetSelect.appendChild(o);
    }
    const customOpt = document.createElement("option");
    customOpt.value = CUSTOM; customOpt.textContent = "Custom...";
    presetSelect.appendChild(customOpt);

    const syncCustom = () => { customRow.hidden = presetSelect.value !== CUSTOM; };

    const fields = {
      pingInterval: $("set-ping-interval"),
      connRefresh: $("set-conn-refresh"),
      logAge: $("set-log-age"),
    };

    function open() {
      const c = state.config || {};
      const preset = TARGET_PRESETS.find((p) => p.host === c.target);
      presetSelect.value = preset ? preset.host : CUSTOM;
      customInput.value = preset ? "" : (c.target || "");
      syncCustom();
      fields.pingInterval.value = c.ping_interval_seconds ?? state.pollIntervalMs / 1000;
      fields.connRefresh.value = c.connection_refresh_seconds ?? state.connRefreshMs / 1000;
      fields.logAge.value = c.max_log_age_minutes ?? 180;
      errorEl.textContent = "";
      modal.hidden = false;
    }
    function close() { modal.hidden = true; }

    $("settings-btn").addEventListener("click", open);
    $("settings-close").addEventListener("click", close);
    $("settings-cancel").addEventListener("click", close);
    $("settings-backdrop").addEventListener("click", close);
    presetSelect.addEventListener("change", syncCustom);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });

    $("settings-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      let target = presetSelect.value;
      if (target === CUSTOM) {
        target = customInput.value.trim();
        if (!target) { errorEl.textContent = "Custom target must not be empty"; return; }
      }
      const payload = {
        target,
        ping_interval_seconds: Number(fields.pingInterval.value),
        connection_refresh_seconds: Number(fields.connRefresh.value),
        max_log_age_minutes: Math.round(Number(fields.logAge.value)),
      };
      const saveBtn = $("settings-save");
      saveBtn.disabled = true; saveBtn.textContent = "Saving...";
      try {
        const res = await fetch("/api/config", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
          let detail = `Save failed (HTTP ${res.status})`;
          try {
            detail = parseConfigError(res, await res.json());
          } catch {}
          errorEl.textContent = detail;
          return;
        }
        applyConfig(await res.json());
        close();
        await Sync.reload();
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Could not reach the server - settings not saved";
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = "Save";
      }
    });
  }

  async function onWindowSelectChange(windowMinutes) {
    state.windowMinutes = windowMinutes;
    setText("window-label", String(windowMinutes));
    await Sync.reload();
  }

  function onWindowDeactivated() {
    state.lastHiddenAt = Date.now();
  }

  function onWindowActivated() {
    if (document.hidden) return;
    clearTimeout(state.activateTimer);
    state.activateTimer = setTimeout(() => {
      state.activateTimer = null;
      paintGraphs({ waitForLayout: true });
      void Sync.fetchNow();
    }, 50);
  }

  window.addEventListener("nm:layout-change", () => paintGraphs({ waitForLayout: true }));

  async function bootstrap() {
    Sync.init({
      getWindowMinutes: () => state.windowMinutes,
      getPollIntervalMs: () => state.pollIntervalMs,
      getLastChartDataAt: () => state.lastChartDataAt,
      onPayload: ingestMetrics,
      onError: () => setStatusPill("error", "Connection error"),
      onStaleness: updateStaleness,
    });

    if (window.ViewBuilder) {
      ViewBuilder.init({ onLayoutApplied: () => paintGraphs({ waitForLayout: true }) });
    }
    try { DC.initCharts($); } catch (err) { console.error("chart init failed", err); }
    initSettings();

    try {
      const config = await fetchJson("/api/config");
      applyConfig(config);
    } catch (err) {
      console.error("config load failed", err);
      populateWindowOptions([5, 15, 30, 60, 120], 30);
    }

    $("window-select").addEventListener("change", (e) => {
      const windowMinutes = Number(e.target.value);
      localStorage.setItem(ViewsModel.STORAGE_KEYS.windowMinutes, e.target.value);
      void onWindowSelectChange(windowMinutes);
    });

    await Promise.all([Sync.start(), refreshConnection()]);
    if (!state.lastChartDataAt) state.lastChartDataAt = Date.now();
    scheduleConnection();
    state.stalenessTimer = setInterval(updateStaleness, 1000);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) onWindowDeactivated();
      else onWindowActivated();
    });
    window.addEventListener("focus", onWindowActivated);
    window.addEventListener("blur", onWindowDeactivated);
  }

  async function startDashboard() {
    await bootstrap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { startDashboard(); });
  } else {
    startDashboard();
  }
})();
