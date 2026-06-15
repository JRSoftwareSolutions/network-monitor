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
    lastNow: null,
    lastUpdatedAt: 0,
    lastFullRefreshAt: 0,
    lastChartDataAt: 0,
    lastHiddenAt: 0,
    lastGraphPayload: null,
    config: null,
    sparklineNow: null,
    indicatorSeries: null,
    heartbeatSamples: [],
    pollIntervalMs: 1000,
    fullRefreshMs: 60000,
    connRefreshMs: 120000,
    pollTimer: null,
    pollInFlight: false,
    pollAbortController: null,
    pollPending: null,
    pollSequencing: false,
    recoveryTimer: null,
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

  function chartKnownTs() {
    if (!state.lastGraphPayload) return state.lastSampleTs;
    const line = DC.chartLineSamples(state.lastGraphPayload);
    if (line.length) return line[line.length - 1].ts;
    return state.lastSampleTs;
  }

  function syncChartKnownTs() {
    state.lastSampleTs = chartKnownTs() ?? state.lastSampleTs;
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
    state.lastGraphPayload = payload;
    const windowMins = payload.window_minutes ?? state.windowMinutes;
    setText("window-label", String(windowMins));
    DR.renderStats(payload.stats);
    DR.renderHealth(payload.health);
    DR.renderTimeline(payload.blocks);
    DR.renderBlocksChart(payload.blocks);
    DR.renderOutages(payload.outages);
    DR.renderRecent(recentSamples(payload));
    DC.updateCharts(payload);
  }

  function patchGraphChartsFromLive(livePayload) {
    if (!state.lastGraphPayload) return;
    state.lastGraphPayload = {
      ...state.lastGraphPayload,
      window_minutes: state.windowMinutes,
      latest_ts: livePayload.latest_ts ?? state.lastGraphPayload.latest_ts,
      recent_samples: livePayload.recent_samples ?? [],
      now: livePayload.now
        ? { ...state.lastGraphPayload.now, ...livePayload.now }
        : state.lastGraphPayload.now,
    };
    DC.updateCharts(state.lastGraphPayload);
    state.lastChartDataAt = Date.now();
  }

  function applyMetrics(payload, { full = false } = {}) {
    if (payload.now) state.lastNow = payload.now;
    renderLiveSections(payload);

    if (full) {
      renderGraphSections(payload);
      state.lastFullRefreshAt = Date.now();
    } else {
      patchGraphChartsFromLive(payload);
    }

    state.lastUpdatedAt = Date.now();
    if (full || payload.recent_samples?.length) {
      state.lastChartDataAt = Date.now();
    }
    syncChartKnownTs();
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

  let activePollPromise = null;

  function queuePollIntent(intent) {
    const rank = { live: 1, activate: 2, full: 3 };
    const current = state.pollPending;
    if (!current || rank[intent] >= rank[current]) state.pollPending = intent;
  }

  function requestPoll(forceFull) {
    if (state.pollInFlight) {
      if (forceFull) {
        state.pollAbortController?.abort();
        queuePollIntent("full");
      } else {
        queuePollIntent("live");
      }
      return activePollPromise ?? Promise.resolve();
    }
    activePollPromise = runPoll(forceFull);
    return activePollPromise;
  }

  async function fetchMetricsCycle(forceFull, signal) {
    const fetchOpts = { signal };
    if (needFullRefresh(forceFull)) {
      const params = new URLSearchParams({ windowMinutes: String(state.windowMinutes) });
      const payload = await fetchJson(`/api/metrics?${params.toString()}`, fetchOpts);
      applyMetrics(payload, { full: true });
      return;
    }

    const known = chartKnownTs();
    const knownTs = known ? `?knownTs=${encodeURIComponent(known)}` : "";
    const live = await fetchJson(`/api/metrics/live${knownTs}`, fetchOpts);
    if (live.unchanged) {
      state.lastUpdatedAt = Date.now();
      updateStaleness();
      if (live.now?.display_verdict && state.lastNow) {
        DR.renderHero({ ...state.lastNow, display_verdict: live.now.display_verdict });
      }
      return;
    }
    applyMetrics(live, { full: false });
  }

  async function runPoll(forceFull) {
    if (state.pollInFlight) return;
    state.pollInFlight = true;
    let nextForceFull = forceFull;
    try {
      do {
        const retryFull = state.pollPending === "full";
        state.pollPending = null;
        const force = nextForceFull || retryFull;
        nextForceFull = false;

        const abortController = new AbortController();
        state.pollAbortController = abortController;
        try {
          await fetchMetricsCycle(force, abortController.signal);
        } catch (err) {
          if (err?.name === "AbortError") continue;
          console.error(err);
          setStatusPill("error", "Connection error");
        } finally {
          state.pollAbortController = null;
        }
      } while (state.pollPending === "full");
    } finally {
      state.pollInFlight = false;
      activePollPromise = null;
      if (state.pollSequencing) return;
      const pending = state.pollPending;
      state.pollPending = null;
      if (pending === "activate") {
        void catchUpPoll({ repaint: true });
      } else if (pending === "full") {
        void requestPoll(true);
      } else if (pending === "live") {
        void requestPoll(false);
      }
    }
  }

  async function awaitIdlePoll() {
    if (!state.pollInFlight) return;
    state.pollAbortController?.abort();
    await (activePollPromise ?? Promise.resolve());
  }

  async function runPollSequence(forceFull, thenLive) {
    state.pollSequencing = true;
    try {
      await runPoll(forceFull);
      if (thenLive) await runPoll(false);
    } finally {
      state.pollSequencing = false;
      const pending = state.pollPending;
      state.pollPending = null;
      if (pending === "activate") {
        void catchUpPoll({ repaint: true });
      } else if (pending === "full") {
        void requestPoll(true);
      } else if (pending === "live") {
        void requestPoll(false);
      }
    }
  }

  async function catchUpPoll({ resetFull = false, repaint = false } = {}) {
    clearTimeout(state.pollTimer);
    if (resetFull) state.lastFullRefreshAt = 0;
    await awaitIdlePoll();
    const forceFull = resetFull || isPollStale() || hiddenLongEnough();
    await runPollSequence(forceFull, forceFull);
    schedulePoll();
    if (repaint) refreshCharts();
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
    state.pollTimer = setTimeout(async () => {
      await requestPoll(false);
      schedulePoll();
    }, nextPollDelayMs());
  }

  function pollStaleThresholdMs() {
    return Math.max(state.pollIntervalMs * 2, 3000);
  }

  function isPollStale() {
    return !state.lastChartDataAt
      || Date.now() - state.lastChartDataAt > pollStaleThresholdMs();
  }

  function hiddenLongEnough() {
    return state.lastHiddenAt > 0 && Date.now() - state.lastHiddenAt > 2000;
  }

  function onWindowDeactivated() {
    state.lastHiddenAt = Date.now();
  }

  function onWindowActivated() {
    if (document.hidden) return;
    clearTimeout(state.activateTimer);
    state.activateTimer = setTimeout(() => {
      state.activateTimer = null;
      refreshCharts();
      if (state.pollInFlight) {
        queuePollIntent("activate");
        return;
      }
      void catchUpPoll({ repaint: true });
    }, 50);
  }

  function schedulePollRecovery() {
    clearInterval(state.recoveryTimer);
    state.recoveryTimer = setInterval(() => {
      if (state.pollInFlight || !isPollStale()) return;
      clearTimeout(state.pollTimer);
      requestPoll(needFullRefresh(false)).finally(() => schedulePoll());
    }, 2000);
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
        clearTimeout(state.pollTimer);
        await catchUpPoll({ resetFull: true, repaint: true });
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Could not reach the server - settings not saved";
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = "Save";
      }
    });
  }

  function refreshCharts() {
    DC.layoutSettledRefresh(() => {
      if (state.lastGraphPayload) {
        DC.updateCharts(state.lastGraphPayload);
        DR.renderTimeline(state.lastGraphPayload.blocks);
        DR.renderBlocksChart(state.lastGraphPayload.blocks);
      }
      DC.redrawCharts();
      DR.updateIndicatorSparklines(state.sparklineNow, state.indicatorSeries);
    });
  }

  window.addEventListener("nm:layout-change", refreshCharts);

  async function bootstrap() {
    if (window.ViewBuilder) {
      ViewBuilder.init({
        onLayoutApplied: refreshCharts,
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
      state.lastFullRefreshAt = 0;
      state.lastSampleTs = null;
      clearTimeout(state.pollTimer);
      void catchUpPoll({ resetFull: true, repaint: true });
    });

    await Promise.all([runPoll(true), refreshConnection()]);
    if (!state.lastChartDataAt) state.lastChartDataAt = Date.now();
    schedulePoll();
    scheduleConnection();
    state.stalenessTimer = setInterval(updateStaleness, 1000);
    schedulePollRecovery();
    refreshCharts();

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
