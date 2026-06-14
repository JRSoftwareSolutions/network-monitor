/* =====================================================================
   Network Monitor - dashboard orchestration
   ===================================================================== */
(function () {
  "use strict";

  const F = window.DashboardFormat;
  const DR = window.DashboardRender;
  const DC = window.DashboardCharts;
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
    lastUpdatedAt: 0,
    lastFullRefreshAt: 0,
    config: null,
    pollTimer: null,
    connTimer: null,
    stalenessTimer: null,
    pollIntervalMs: 1000,
    fullRefreshMs: 60000,
    connRefreshMs: 120000,
    sparklineNow: null,
    indicatorSeries: null,
    heartbeatSamples: [],
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
    state.indicatorSeries = payload.indicator_series || null;
    DR.renderHero(now);
    DR.renderStatus(now);
    DR.renderIndicators(now);
    DR.renderLive(now, samples);
    DR.renderNarrative(now);
    DR.updateIndicatorSparklines(now, payload.indicator_series);
  }

  function renderGraphSections(payload) {
    const windowMins = payload.window_minutes ?? state.windowMinutes;
    setText("window-label", String(windowMins));
    DR.renderStats(payload.stats);
    DR.renderHealth(payload.health);
    DR.renderTimeline(payload.blocks);
    DR.renderOutages(payload.outages);
    DR.renderRecent(recentSamples(payload));
    DC.updateCharts(payload);
  }

  function applyMetrics(payload, { full = false } = {}) {
    renderLiveSections(payload);

    if (full) {
      renderGraphSections(payload);
      state.lastFullRefreshAt = Date.now();
    }

    state.lastSampleTs = payload.latest_ts ?? state.lastSampleTs;
    state.lastUpdatedAt = Date.now();
    updateStaleness();
    const has = Boolean(recentSamples(payload).length || (payload.samples || []).length);
    setStatusPill(has ? "live" : "waiting", has ? "Live" : "Waiting for data...");
  }

  function graphRefreshDue() {
    return Boolean(
      state.lastFullRefreshAt
      && Date.now() - state.lastFullRefreshAt >= state.fullRefreshMs,
    );
  }

  function needFullRefresh(forceFull) {
    return forceFull || !state.lastFullRefreshAt || graphRefreshDue();
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function poll(forceFull) {
    try {
      const full = needFullRefresh(forceFull);
      if (full) {
        const params = new URLSearchParams({ windowMinutes: String(state.windowMinutes) });
        const payload = await fetchJson(`/api/metrics?${params.toString()}`);
        applyMetrics(payload, { full: true });
        return;
      }

      const knownTs = state.lastSampleTs ? `?knownTs=${encodeURIComponent(state.lastSampleTs)}` : "";
      const live = await fetchJson(`/api/metrics/live${knownTs}`);
      if (live.unchanged) return;
      applyMetrics(live, { full: false });
    } catch (err) {
      console.error(err);
      setStatusPill("error", "Connection error");
    }
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

  function nextPollDelayMs() {
    const pingDelay = state.pollIntervalMs;
    if (!state.lastFullRefreshAt) return pingDelay;
    const untilGraph = state.fullRefreshMs - (Date.now() - state.lastFullRefreshAt);
    if (untilGraph <= 0) return 0;
    return Math.min(pingDelay, untilGraph);
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(async () => { await poll(false); schedulePoll(); }, nextPollDelayMs());
  }

  function resumeDashboard() {
    clearTimeout(state.pollTimer);
    poll(true).finally(() => {
      schedulePoll();
      resizeCharts();
    });
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
    const prevFullRefreshMs = state.fullRefreshMs;
    state.config = config;
    if (window.DashboardRating && config.gaming_thresholds) {
      window.DashboardRating.applyThresholds(config.gaming_thresholds);
    }
    window.DashboardRating?.updateHeartbeatLegend($("hb-legend"));
    setText("target-label", config.target || dash);
    populateWindowOptions(config.window_options && config.window_options.length ? config.window_options : [5, 15, 30, 60, 120], config.default_window_minutes || 30);
    state.pollIntervalMs = Math.max(250, (config.ping_interval_seconds || 1) * 1000);
    if (config.full_refresh_seconds != null) state.fullRefreshMs = config.full_refresh_seconds * 1000;
    if (config.connection_refresh_seconds != null) state.connRefreshMs = config.connection_refresh_seconds * 1000;
    if (prevFullRefreshMs !== state.fullRefreshMs) state.lastFullRefreshAt = 0;
    schedulePoll();
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
      fullRefresh: $("set-full-refresh"),
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
      fields.fullRefresh.value = c.full_refresh_seconds ?? state.fullRefreshMs / 1000;
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
        full_refresh_seconds: Number(fields.fullRefresh.value),
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
        poll(true);
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Could not reach the server - settings not saved";
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = "Save";
      }
    });
  }

  function resizeCharts() {
    DC.resizeCharts();
    DR.updateIndicatorSparklines(state.sparklineNow, state.indicatorSeries);
  }

  window.addEventListener("nm:layout-change", resizeCharts);

  async function bootstrap() {
    if (window.ViewBuilder) {
      ViewBuilder.init({
        onLayoutApplied: resizeCharts,
      });
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
      state.windowMinutes = Number(e.target.value);
      localStorage.setItem(ViewsModel.STORAGE_KEYS.windowMinutes, e.target.value);
      poll(true);
    });

    await Promise.all([poll(true), refreshConnection()]);
    schedulePoll();
    scheduleConnection();
    state.stalenessTimer = setInterval(updateStaleness, 1000);
    resizeCharts();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) resumeDashboard();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
