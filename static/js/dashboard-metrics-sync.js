/* ---------- unified metrics sync (single /api/metrics poll loop) ---------- */

window.DashboardMetricsSync = (() => {
  "use strict";

  let callbacks = null;
  let pollTimer = null;
  let recoveryTimer = null;
  let abortController = null;
  let inFlight = false;
  let inFlightStartedAt = 0;
  let pendingFetch = false;
  let knownTs = null;
  let syncedWindowMinutes = null;
  let fetchGeneration = 0;
  let idleWaiters = [];

  function init(opts) {
    callbacks = opts;
  }

  function getKnownTs() {
    return knownTs;
  }

  function notifyIdle() {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function waitForIdle() {
    if (!inFlight) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function pollIntervalMs() {
    return Math.max(250, callbacks?.getPollIntervalMs?.() ?? 1000);
  }

  function staleThresholdMs() {
    return Math.max(pollIntervalMs() * 2, 3000);
  }

  function isStale() {
    const lastAt = callbacks?.getLastChartDataAt?.() ?? 0;
    return !lastAt || Date.now() - lastAt > staleThresholdMs();
  }

  function needsWindowSync() {
    return syncedWindowMinutes !== callbacks.getWindowMinutes();
  }

  async function fetchJson(url, signal) {
    const timeoutMs = 10000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    const onOuterAbort = () => timeoutController.abort();
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new DOMException("Aborted", "AbortError");
      }
      signal.addEventListener("abort", onOuterAbort, { once: true });
    }
    try {
      const res = await fetch(url, { signal: timeoutController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", onOuterAbort);
    }
  }

  function metricsUrl(windowMinutes, { skipKnownTs = false } = {}) {
    const params = new URLSearchParams({ windowMinutes: String(windowMinutes) });
    if (!skipKnownTs && knownTs) params.set("knownTs", knownTs);
    return `/api/metrics?${params.toString()}`;
  }

  function responseStale(generation, windowMinutes) {
    return generation !== fetchGeneration
      || windowMinutes !== callbacks.getWindowMinutes();
  }

  function applyPayload(payload, generation, windowMinutes) {
    if (responseStale(generation, windowMinutes)) return false;

    if (payload.unchanged && needsWindowSync()) {
      knownTs = null;
      pendingFetch = true;
      return false;
    }

    if (!payload.unchanged) {
      if (payload.latest_ts) knownTs = payload.latest_ts;
      syncedWindowMinutes = windowMinutes;
    }

    callbacks.onPayload(payload);
    callbacks.onStaleness?.();
    return true;
  }

  async function tick({ force = false, skipKnownTs = false } = {}) {
    if (inFlight) {
      if (force) {
        abortController?.abort();
        await waitForIdle();
      } else {
        pendingFetch = true;
        return;
      }
    }

    inFlight = true;
    inFlightStartedAt = Date.now();
    const generation = fetchGeneration;
    const windowMinutes = callbacks.getWindowMinutes();
    const useSkipKnownTs = skipKnownTs || needsWindowSync();
    abortController = new AbortController();

    try {
      const payload = await fetchJson(
        metricsUrl(windowMinutes, { skipKnownTs: useSkipKnownTs }),
        abortController.signal,
      );

      if (payload.unchanged && needsWindowSync()) {
        knownTs = null;
        pendingFetch = true;
        return;
      }

      applyPayload(payload, generation, windowMinutes);
    } catch (err) {
      if (err?.name !== "AbortError") callbacks.onError?.(err);
    } finally {
      abortController = null;
      inFlight = false;
      inFlightStartedAt = 0;
      notifyIdle();
      if (pendingFetch) {
        pendingFetch = false;
        await tick();
      }
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        await tick();
      } finally {
        schedulePoll();
      }
    }, pollIntervalMs());
  }

  function schedulePollRecovery() {
    clearInterval(recoveryTimer);
    recoveryTimer = setInterval(() => {
      const hung = inFlight && Date.now() - inFlightStartedAt > 15000;
      if (hung) {
        abortController?.abort();
        return;
      }
      if (inFlight || (!isStale() && !needsWindowSync())) return;
      clearTimeout(pollTimer);
      tick({ force: needsWindowSync(), skipKnownTs: needsWindowSync() }).finally(schedulePoll);
    }, 2000);
  }

  function stop() {
    clearTimeout(pollTimer);
    pollTimer = null;
    clearInterval(recoveryTimer);
    recoveryTimer = null;
    abortController?.abort();
    abortController = null;
  }

  async function reload() {
    fetchGeneration += 1;
    knownTs = null;
    syncedWindowMinutes = null;
    abortController?.abort();
    clearTimeout(pollTimer);
    pendingFetch = false;
    await waitForIdle();
    await tick({ force: true, skipKnownTs: true });
    schedulePoll();
  }

  async function start() {
    schedulePollRecovery();
    await tick({ skipKnownTs: true });
    schedulePoll();
  }

  async function fetchNow() {
    clearTimeout(pollTimer);
    const skipKnownTs = needsWindowSync();
    await tick({ force: skipKnownTs, skipKnownTs });
    schedulePoll();
  }

  return {
    init,
    start,
    stop,
    reload,
    fetchNow,
    getKnownTs,
  };
})();
