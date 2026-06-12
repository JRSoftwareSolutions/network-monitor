const WINDOW_STORAGE_KEY = "networkMonitor.windowMinutes";
const CONNECTION_REFRESH_MS = 30000;
const STALE_WARN_SECONDS = 10;
const STALE_ERROR_SECONDS = 30;
const HEARTBEAT_COUNT = 60;
const HEARTBEAT_MAX_MS = 150;

/* ---------- dom refs ---------- */

const windowSelect = document.getElementById("window-select");
const statusIndicator = document.getElementById("status-indicator");
const statusText = document.getElementById("status-text");
const updatedIndicator = document.getElementById("updated-indicator");
const targetLabel = document.getElementById("target-label");
const connectionLabel = document.getElementById("connection-label");
const faviconLink = document.getElementById("favicon");

const hero = document.getElementById("hero");
const verdictLabel = document.getElementById("verdict-label");
const verdictBaseline = document.getElementById("verdict-baseline");
const verdictJitter = document.getElementById("verdict-jitter");
const verdictLoss = document.getElementById("verdict-loss");
const verdictSince = document.getElementById("verdict-since");
const verdictSinceVal = document.getElementById("verdict-since-val");
const verdictPending = document.getElementById("verdict-pending");
const verdictPendingLabel = document.getElementById("verdict-pending-label");
const verdictPendingSec = document.getElementById("verdict-pending-sec");
const heroReadout = document.getElementById("hero-readout");
const arcValue = document.getElementById("arc-value");
const baselineValue = document.getElementById("baseline-value");
const trendPill = document.getElementById("trend-pill");
const trendLabel = document.getElementById("trend-label");
const trendDelta = document.getElementById("trend-delta");

const statusPanel = document.getElementById("status-panel");
const statusHeadline = document.getElementById("status-headline");
const statusSummary = document.getElementById("status-summary");
const statusPending = document.getElementById("status-pending");
const statusPendingLabel = document.getElementById("status-pending-label");
const statusPendingSec = document.getElementById("status-pending-sec");
const statusMetrics = {
  ping: {
    value: document.getElementById("status-val-ping"),
    note: document.getElementById("status-note-ping"),
  },
  jitter: {
    value: document.getElementById("status-val-jitter"),
    note: document.getElementById("status-note-jitter"),
  },
  loss: {
    value: document.getElementById("status-val-loss"),
    note: document.getElementById("status-note-loss"),
  },
  spikes: {
    value: document.getElementById("status-val-spikes"),
    note: document.getElementById("status-note-spikes"),
  },
  trend: {
    value: document.getElementById("status-val-trend"),
    note: document.getElementById("status-note-trend"),
  },
};
const statusChipSlots = {};
for (const slot of document.querySelectorAll("[data-chip]")) {
  statusChipSlots[slot.dataset.chip] = {
    root: slot,
    value: slot.querySelector(".chip-value"),
  };
}

const instantChip = document.getElementById("instant-chip");
const instantChipLabel = document.getElementById("instant-chip-label");
const livePing = document.getElementById("live-ping");
const livePingSub = document.getElementById("live-ping-sub");
const heartbeatEl = document.getElementById("heartbeat");

const healthChip = document.getElementById("health-chip");
const healthLabel = document.getElementById("health-label");
const healthDetail = document.getElementById("health-detail");
const windowLabel = document.getElementById("window-label");

const avgLatencyEl = document.getElementById("avg-latency");
const minLatencyEl = document.getElementById("min-latency");
const maxLatencyEl = document.getElementById("max-latency");
const p95LatencyEl = document.getElementById("p95-latency");
const avgJitterEl = document.getElementById("avg-jitter");
const packetLossEl = document.getElementById("packet-loss");
const uptimePctEl = document.getElementById("uptime-pct");
const sampleCountEl = document.getElementById("sample-count");
const recentTable = document.getElementById("recent-table");
const outagesTable = document.getElementById("outages-table");
const blocksPanelTitle = document.getElementById("blocks-panel-title");

let latencyChart;
let lossChart;
let latencyBlocksChart;
let pollTimer;
let connectionTimer;
let stalenessTimer;
let pollIntervalMs = 1000;
let lastSampleTs = null;
let lastUpdatedAt = null;
let lastFaviconLevel = null;

const LEVEL_COLORS = {
  great: "#3dffa2",
  good: "#4fd1ff",
  okay: "#ffc24d",
  bad: "#ff5d6c",
  offline: "#ff3355",
  no_data: "#8fa3c2",
};

const CHART_COLORS = {
  latency: "#45c8ff",
  jitter: "#b388ff",
  loss: "#ff5d6c",
  fail: "#ff5d6c",
};

const CHART_GRID = "rgba(126, 164, 222, 0.08)";
const CHART_TICK = "#5f7396";
const MONO_FONT = "'JetBrains Mono', Consolas, monospace";

/* ---------- rating model (mirrors backend thresholds) ---------- */

const RATING_ORDER = ["great", "good", "okay", "bad"];

/* Segment edges for the indicator scale bars: [min, b1, b2, b3, visualMax].
   The four segments map to great / good / okay / bad. */
const SCALE_EDGES = {
  ping: [0, 40, 70, 110, 200],
  jitter: [0, 8, 15, 30, 60],
  loss: [0, 0, 1, 3, 15],
  spikes: [0, 0, 1, 4, 10],
};

function rateMetric(metric, value) {
  switch (metric) {
    case "ping":
      return value < 40 ? "great" : value < 70 ? "good" : value < 110 ? "okay" : "bad";
    case "jitter":
      return value < 8 ? "great" : value < 15 ? "good" : value < 30 ? "okay" : "bad";
    case "loss":
      return value <= 0 ? "great" : value < 1 ? "good" : value <= 3 ? "okay" : "bad";
    case "spikes":
      return value <= 0 ? "great" : value < 1 ? "good" : value <= 4 ? "okay" : "bad";
    default:
      return "none";
  }
}

/* Position (0-100%) on a 4-segment scale bar, aligned with rating zones. */
function scalePercent(metric, value, rating) {
  const edges = SCALE_EDGES[metric];
  const segIndex = RATING_ORDER.indexOf(rating);
  if (!edges || segIndex < 0) {
    return 0;
  }
  const lo = edges[segIndex];
  const hi = edges[segIndex + 1];
  const within = hi > lo ? clamp((value - lo) / (hi - lo), 0, 1) : 0.5;
  return (segIndex + within) * 25;
}

/* ---------- formatting ---------- */

function formatMs(value, digits = 1) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)} ms`;
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
}

function formatConnection(connection) {
  if (!connection?.type || !connection?.name) {
    return "—";
  }
  return `${connection.type} · ${connection.name}`;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setSlotText(el, text) {
  if (el) {
    el.textContent = text;
  }
}

function formatSlotMs(value, digits = 0) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)} ms`;
}

function formatSlotPct(value, digits = 1) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
}

function formatSlotRate(value, digits = 1) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)}/min`;
}

/* ---------- number tweening (smooth value updates) ---------- */

const activeTweens = new Map();
let tweenFrame = null;

function tweenNumber(el, target, { duration = 700, decimals = 0 } = {}) {
  if (target === null || target === undefined || Number.isNaN(target)) {
    activeTweens.delete(el);
    delete el.dataset.tween;
    el.textContent = "—";
    return;
  }
  const current = Number(el.dataset.tween);
  if (!Number.isFinite(current)) {
    // First real value: snap straight to it.
    activeTweens.delete(el);
    el.dataset.tween = String(target);
    el.textContent = target.toFixed(decimals);
    return;
  }
  const existing = activeTweens.get(el);
  if (existing && Math.abs(existing.to - target) < 1e-9) {
    return;
  }
  if (Math.abs(current - target) < Math.pow(10, -decimals) / 2) {
    activeTweens.delete(el);
    el.dataset.tween = String(target);
    el.textContent = target.toFixed(decimals);
    return;
  }
  activeTweens.set(el, { from: current, to: target, start: performance.now(), duration, decimals });
  if (!tweenFrame) {
    tweenFrame = requestAnimationFrame(tweenTick);
  }
}

function tweenTick(ts) {
  for (const [el, tween] of activeTweens) {
    const progress = Math.min(1, (ts - tween.start) / tween.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = tween.from + (tween.to - tween.from) * eased;
    el.dataset.tween = String(value);
    el.textContent = value.toFixed(tween.decimals);
    if (progress >= 1) {
      activeTweens.delete(el);
    }
  }
  tweenFrame = activeTweens.size ? requestAnimationFrame(tweenTick) : null;
}

/* ---------- hero: stabilized verdict + smoothed readout ---------- */

const ARC_LENGTH = arcValue.getTotalLength();
arcValue.style.strokeDasharray = `${ARC_LENGTH} ${ARC_LENGTH}`;
arcValue.style.strokeDashoffset = String(ARC_LENGTH);

function setArc(baseline) {
  if (baseline === null || baseline === undefined) {
    arcValue.style.strokeDashoffset = String(ARC_LENGTH);
    return;
  }
  const rating = rateMetric("ping", baseline);
  const frac = clamp(scalePercent("ping", baseline, rating) / 100, 0.02, 1);
  arcValue.style.strokeDashoffset = String(ARC_LENGTH * (1 - frac));
}

const TREND_LABELS = {
  improving: "improving",
  steady: "steady",
  degrading: "degrading",
  unknown: "trend pending",
};

function updateTrend(trend) {
  const direction = trend?.direction ?? "unknown";
  trendPill.dataset.trend = direction;
  trendLabel.textContent = TREND_LABELS[direction] ?? TREND_LABELS.unknown;

  const delta = trend?.latency_delta_ms;
  if ((direction === "improving" || direction === "degrading") && delta != null && Math.abs(delta) >= 1) {
    const sign = delta > 0 ? "+" : "−";
    trendDelta.hidden = false;
    trendDelta.textContent = `${sign}${Math.abs(delta).toFixed(0)} ms vs prior 10 min`;
  } else {
    trendDelta.hidden = true;
    trendDelta.textContent = "";
  }
}

function updateHeroDetail(indicators) {
  const ping = indicators.ping;
  const jitter = indicators.jitter;
  const loss = indicators.loss;

  setSlotText(
    verdictBaseline,
    ping?.value != null ? formatSlotMs(ping.value, 0) : "—",
  );
  setSlotText(
    verdictJitter,
    jitter?.value != null ? formatSlotMs(jitter.value, 1) : "—",
  );
  setSlotText(
    verdictLoss,
    loss?.value != null ? formatSlotPct(loss.value, 1) : "—",
  );
}

function updateHero(now) {
  const display = now?.display_verdict ?? { level: "no_data", label: "No data", since_seconds: 0, pending: null };
  const indicators = now?.indicators ?? {};

  document.body.dataset.level = display.level;
  hero.dataset.level = display.level;
  verdictLabel.textContent = display.label;
  updateHeroDetail(indicators);

  if (display.level !== "no_data" && display.since_seconds != null) {
    verdictSince.hidden = false;
    setSlotText(verdictSinceVal, formatDuration(Math.max(1, Math.floor(display.since_seconds))));
  } else {
    verdictSince.hidden = true;
  }

  const pending = display.pending;
  if (pending) {
    const remaining = Math.max(0, Math.ceil(pending.needed_seconds - pending.for_seconds));
    verdictPending.hidden = false;
    verdictPending.dataset.direction = pending.direction;
    verdictPendingLabel.textContent = pending.direction === "up"
      ? "improving — confirming"
      : "checking slowdown —";
    setSlotText(verdictPendingSec, String(remaining));
  } else {
    verdictPending.hidden = true;
  }

  const baseline = now?.baseline_ms ?? null;
  if (baseline != null) {
    heroReadout.dataset.rating = rateMetric("ping", baseline);
  } else {
    heroReadout.dataset.rating = display.level === "offline" ? "bad" : "none";
  }
  tweenNumber(baselineValue, baseline, { decimals: 0 });
  setArc(baseline);

  updateTrend(now?.trend);
  updateTabTitle(baseline, display);
}

function updateTabTitle(baseline, display) {
  if (display.level === "no_data") {
    document.title = "Network Monitor";
  } else if (baseline != null) {
    document.title = `${Math.round(baseline)} ms · ${display.label}`;
  } else {
    document.title = `${display.label} · Network Monitor`;
  }
  setFavicon(display.level);
}

function setFavicon(level) {
  if (level === lastFaviconLevel) {
    return;
  }
  lastFaviconLevel = level;
  const color = LEVEL_COLORS[level] ?? LEVEL_COLORS.no_data;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
    "<rect width='32' height='32' rx='8' fill='#0a101c'/>" +
    "<path d='M6 20c4-6 8-9 10-9s6 3 10 9' stroke='#3de8ff' stroke-width='2.5' fill='none' stroke-linecap='round'/>" +
    `<circle cx='16' cy='22' r='2.5' fill='${color}'/>` +
    "</svg>";
  faviconLink.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ---------- current status narrative ---------- */

const STATUS_HEADLINES = {
  great: "Rock solid",
  good: "Stable",
  okay: "A bit shaky",
  bad: "Unstable",
  offline: "Connection down",
  no_data: "Waiting for data",
};

const STATUS_SUMMARIES = {
  great: "Ideal for competitive play — latency, jitter, and loss are all in great shape.",
  good: "Smooth for nearly any game — nothing here should get in your way.",
  okay: "Playable, but fast-paced games may feel occasional hitches.",
  bad: "Expect noticeable lag in real-time games until this improves.",
  offline: "Online games will freeze or disconnect until the connection recovers.",
  no_data: "Waiting for the first pings to come in…",
};

const TREND_NOTES = {
  improving: "Latency is trending down versus the prior 10 minutes.",
  steady: "Latency has been steady over the last 20 minutes.",
  degrading: "Latency is trending up versus the prior 10 minutes.",
  unknown: "Not enough history yet to judge a trend.",
};

let lastStatusSummaryKey = "";
let lastStatusNoteKey = {};

function updateStatusMetricRow(key, { valueText, noteText, hasData = true }) {
  const row = statusMetrics[key];
  if (!row) {
    return;
  }
  setSlotText(row.value, valueText);
  const nextNote = noteText ?? (hasData ? row.note.textContent : "—");
  if (nextNote !== lastStatusNoteKey[key]) {
    lastStatusNoteKey[key] = nextNote;
    row.note.textContent = nextNote;
  }
}

function updateStatusChipSlot(key, indicator) {
  const slot = statusChipSlots[key];
  if (!slot) {
    return;
  }
  if (!indicator || indicator.value === null || indicator.value === undefined) {
    slot.root.hidden = true;
    return;
  }

  slot.root.hidden = false;
  slot.root.dataset.level = indicator.level;

  let valueText = "—";
  switch (key) {
    case "ping":
      valueText = formatSlotMs(indicator.value, 0);
      break;
    case "jitter":
      valueText = formatSlotMs(indicator.value, 1);
      break;
    case "loss":
      valueText = formatSlotPct(indicator.value, 1);
      break;
    case "spikes":
      valueText = formatSlotRate(indicator.value, 1);
      break;
    default:
      break;
  }
  setSlotText(slot.value, valueText);
}

function updateStatusPending(display) {
  const pending = display?.pending;
  if (!pending) {
    statusPending.hidden = true;
    return;
  }

  const remaining = Math.max(0, Math.ceil(pending.needed_seconds - pending.for_seconds));
  statusPending.hidden = false;
  statusPending.dataset.direction = pending.direction;
  statusPendingLabel.textContent = pending.direction === "up"
    ? "Improving — confirming"
    : "Possible slowdown — checking";
  setSlotText(statusPendingSec, String(remaining));
}

function updateStatusPanel(now) {
  const display = now?.display_verdict ?? { level: "no_data" };
  const level = display.level ?? "no_data";
  const indicators = now?.indicators ?? {};
  const trend = now?.trend;

  statusPanel.dataset.level = level;
  statusPanel.dataset.stable = display.since_seconds >= 8 ? "true" : "false";
  statusHeadline.textContent = STATUS_HEADLINES[level] ?? STATUS_HEADLINES.no_data;

  if (level === "no_data") {
    for (const key of Object.keys(statusMetrics)) {
      updateStatusMetricRow(key, { valueText: "—", noteText: "—", hasData: false });
    }
    for (const key of Object.keys(statusChipSlots)) {
      statusChipSlots[key].root.hidden = true;
    }
    statusSummary.textContent = STATUS_SUMMARIES.no_data;
    lastStatusSummaryKey = "no_data";
    updateStatusPending(display);
    return;
  }

  if (level === "offline") {
    updateStatusMetricRow("ping", { valueText: "—", noteText: "No response from target" });
    updateStatusMetricRow("jitter", { valueText: "—", noteText: "—", hasData: false });
    updateStatusMetricRow("loss", {
      valueText: formatSlotPct(indicators.loss?.value ?? 100, 1),
      noteText: indicators.loss?.meaning ?? "Connection appears down",
    });
    updateStatusMetricRow("spikes", { valueText: "—", noteText: "—", hasData: false });
    updateStatusMetricRow("trend", { valueText: "—", noteText: "—", hasData: false });
  } else {
    updateStatusMetricRow("ping", {
      valueText: formatSlotMs(indicators.ping?.value, 0),
      noteText: indicators.ping?.meaning ?? "—",
      hasData: indicators.ping?.value != null,
    });
    updateStatusMetricRow("jitter", {
      valueText: formatSlotMs(indicators.jitter?.value, 1),
      noteText: indicators.jitter?.meaning ?? "—",
      hasData: indicators.jitter?.value != null,
    });
    updateStatusMetricRow("loss", {
      valueText: formatSlotPct(indicators.loss?.value, 1),
      noteText: indicators.loss?.meaning ?? "—",
      hasData: indicators.loss?.value != null,
    });
    updateStatusMetricRow("spikes", {
      valueText: formatSlotRate(indicators.spikes?.value, 1),
      noteText: indicators.spikes?.meaning ?? "—",
      hasData: indicators.spikes?.value != null,
    });

    const trendDirection = trend?.direction ?? "unknown";
    updateStatusMetricRow("trend", {
      valueText: TREND_LABELS[trendDirection] ?? TREND_LABELS.unknown,
      noteText: TREND_NOTES[trendDirection] ?? TREND_NOTES.unknown,
    });
  }

  for (const key of Object.keys(statusChipSlots)) {
    updateStatusChipSlot(key, indicators[key]);
  }

  const summaryKey = `${level}:${trend?.direction ?? "unknown"}:${indicators.spikes?.level ?? "none"}`;
  if (summaryKey !== lastStatusSummaryKey) {
    lastStatusSummaryKey = summaryKey;
    statusSummary.textContent = STATUS_SUMMARIES[level] ?? STATUS_SUMMARIES.no_data;
  }

  updateStatusPending(display);
}

/* ---------- key indicators ---------- */

const INDICATOR_DECIMALS = { ping: 0, jitter: 1, loss: 1, spikes: 1 };
const RATING_WORDS = { great: "great", good: "good", okay: "fair", bad: "poor" };

const indicatorEls = {};
for (const key of Object.keys(INDICATOR_DECIMALS)) {
  const root = document.getElementById(`ind-${key}`);
  indicatorEls[key] = {
    root,
    badge: root.querySelector('[data-role="badge"]'),
    value: root.querySelector('[data-role="value"]'),
    meaning: root.querySelector('[data-role="meaning"]'),
    marker: root.querySelector('[data-role="marker"]'),
    sub: root.querySelector('[data-role="sub"]'),
    worst: root.querySelector('[data-role="worst"]'),
    threshold: root.querySelector('[data-role="threshold"]'),
  };
}

let lastIndicatorMeaningKey = {};

function updateIndicators(now) {
  const indicators = now?.indicators ?? {};

  for (const [key, els] of Object.entries(indicatorEls)) {
    const data = indicators[key];
    if (!data || data.value === null || data.value === undefined) {
      els.root.dataset.rating = "none";
      els.badge.textContent = "—";
      tweenNumber(els.value, null);
      els.meaning.textContent = "waiting for data…";
      els.marker.style.left = "0%";
      lastIndicatorMeaningKey[key] = "";
      continue;
    }
    els.root.dataset.rating = data.level;
    els.badge.textContent = RATING_WORDS[data.level] ?? data.level;
    tweenNumber(els.value, data.value, { decimals: INDICATOR_DECIMALS[key] });

    const meaningKey = `${data.level}:${data.meaning ?? ""}`;
    if (meaningKey !== lastIndicatorMeaningKey[key]) {
      lastIndicatorMeaningKey[key] = meaningKey;
      els.meaning.textContent = data.meaning ?? "";
    }

    els.marker.style.left = `${scalePercent(key, data.value, data.level).toFixed(1)}%`;
  }

  const spikes = indicators.spikes;
  const thresholdMs = now?.spike_threshold_ms;
  if (thresholdMs != null) {
    setSlotText(indicatorEls.spikes.threshold, formatSlotMs(thresholdMs, 0));
  } else {
    setSlotText(indicatorEls.spikes.threshold, "—");
  }
  if (spikes?.worst_ms != null) {
    setSlotText(indicatorEls.spikes.worst, formatSlotMs(spikes.worst_ms, 0));
  } else {
    setSlotText(indicatorEls.spikes.worst, "—");
  }
}

/* ---------- live feed (raw micro view) ---------- */

let heartbeatBars = [];
let lastHeartbeatTs = null;

function setBarTransition(bar, enabled) {
  bar.style.transition = enabled ? "" : "none";
}

function applyBarSample(bar, sample, animate = true) {
  setBarTransition(bar, animate);
  if (!sample) {
    bar.className = "hb-bar hb-bar--empty";
    bar.style.height = "5%";
    bar.removeAttribute("title");
    return;
  }
  if (!sample.success) {
    bar.className = "hb-bar hb-bar--fail";
    bar.style.height = "100%";
    bar.title = `${formatTime(sample.ts)} — failed`;
    return;
  }
  bar.className = `hb-bar hb-bar--${rateMetric("ping", sample.latency_ms)}`;
  bar.style.height = `${clamp((sample.latency_ms / HEARTBEAT_MAX_MS) * 100, 6, 100).toFixed(1)}%`;
  bar.title = `${formatTime(sample.ts)} — ${sample.latency_ms.toFixed(1)} ms`;
}

function copyBarState(target, source) {
  setBarTransition(target, false);
  target.className = source.className;
  target.style.height = source.style.height;
  if (source.title) {
    target.title = source.title;
  } else {
    target.removeAttribute("title");
  }
}

function shiftHeartbeatLeft() {
  for (let i = 0; i < HEARTBEAT_COUNT - 1; i += 1) {
    copyBarState(heartbeatBars[i], heartbeatBars[i + 1]);
  }
}

function fillHeartbeatFromRecent(recent) {
  const offset = HEARTBEAT_COUNT - recent.length;
  heartbeatBars.forEach((bar, index) => {
    applyBarSample(bar, recent[index - offset] ?? null, false);
  });
}

function updateHeartbeat(recent) {
  if (!recent.length) {
    lastHeartbeatTs = null;
    fillHeartbeatFromRecent([]);
    return;
  }

  const latest = recent[recent.length - 1];
  if (lastHeartbeatTs === latest.ts) {
    return;
  }

  if (lastHeartbeatTs == null) {
    fillHeartbeatFromRecent(recent);
    lastHeartbeatTs = latest.ts;
    return;
  }

  const lastIndex = recent.findIndex((sample) => sample.ts === lastHeartbeatTs);
  if (lastIndex < 0) {
    fillHeartbeatFromRecent(recent);
    lastHeartbeatTs = latest.ts;
    return;
  }

  for (const sample of recent.slice(lastIndex + 1)) {
    shiftHeartbeatLeft();
    applyBarSample(heartbeatBars[HEARTBEAT_COUNT - 1], sample, true);
  }
  lastHeartbeatTs = latest.ts;
}

function initHeartbeat() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < HEARTBEAT_COUNT; i += 1) {
    const bar = document.createElement("span");
    bar.className = "hb-bar hb-bar--empty";
    bar.style.height = "5%";
    frag.appendChild(bar);
  }
  heartbeatEl.appendChild(frag);
  heartbeatBars = Array.from(heartbeatEl.children);
}

function updateLiveFeed(now, samples) {
  const instant = now?.instant_verdict ?? { level: "no_data", label: "No data" };
  instantChip.dataset.level = instant.level;
  instantChipLabel.textContent = instant.label;

  const latest = samples?.[samples.length - 1];
  if (!latest) {
    livePing.textContent = "—";
    livePing.dataset.rating = "none";
    livePingSub.textContent = "—";
  } else if (latest.success) {
    livePing.textContent = String(Math.round(latest.latency_ms));
    livePing.dataset.rating = rateMetric("ping", latest.latency_ms);
    livePingSub.textContent = formatTime(latest.ts);
  } else {
    livePing.textContent = "✕";
    livePing.dataset.rating = "bad";
    livePingSub.textContent = `${formatTime(latest.ts)} · failed`;
  }

  const recent = (samples ?? []).slice(-HEARTBEAT_COUNT);
  updateHeartbeat(recent);
}

/* ---------- candlestick quality coloring ---------- */

const QUALITY_COLORS = {
  good: { fill: "rgba(61, 255, 162, 0.65)", border: "#3dffa2" },
  fair: { fill: "rgba(255, 194, 77, 0.7)", border: "#ffc24d" },
  poor: { fill: "rgba(255, 93, 108, 0.75)", border: "#ff5d6c" },
};

function bucketBadness(bucket) {
  const lossScore = clamp((bucket.loss_pct ?? 0) / 10, 0, 1);
  const latencyScore = clamp((bucket.avg_ms ?? 0) / 100, 0, 1);
  const jitterScore = clamp((bucket.jitter_avg_ms ?? 0) / 30, 0, 1);

  return lossScore * 0.5 + latencyScore * 0.35 + jitterScore * 0.15;
}

function badnessToQuality(badness) {
  if (badness < 0.35) {
    return "good";
  }
  if (badness < 0.65) {
    return "fair";
  }
  return "poor";
}

function candleQualityColors(context, alpha = true) {
  const point = context.dataset.data[context.dataIndex];
  const quality = badnessToQuality(point?.badness ?? 1);
  const palette = QUALITY_COLORS[quality];
  return alpha ? palette.fill : palette.border;
}

const qualityCandleColorsPlugin = {
  id: "qualityCandleColors",
  beforeDatasetDraw(chart, args) {
    if (args.meta.type !== "candlestick") {
      return;
    }

    const dataset = chart.data.datasets[args.index];
    args.meta.data.forEach((element, index) => {
      const context = { dataset, dataIndex: index };
      const fill = candleQualityColors(context, true);
      const border = candleQualityColors(context, false);

      // Chart.js shares one options object across all candle elements; clone per
      // candle so quality colors are not overwritten by the last bucket.
      element.options = {
        ...element.options,
        backgroundColors: { up: fill, down: fill, unchanged: fill },
        borderColors: { up: border, down: border, unchanged: border },
      };
    });
  },
};

/* ---------- latency threshold bands ---------- */

const LATENCY_BANDS = [
  { from: 0, to: 40, color: "rgba(61, 255, 162, 0.045)" },
  { from: 40, to: 70, color: "rgba(79, 209, 255, 0.035)" },
  { from: 70, to: 110, color: "rgba(255, 194, 77, 0.05)" },
  { from: 110, to: Infinity, color: "rgba(255, 93, 108, 0.06)" },
];

const LATENCY_BAND_LINES = [
  { value: 40, text: "great <40" },
  { value: 70, text: "good <70" },
  { value: 110, text: "fair <110" },
];

const latencyBandsPlugin = {
  id: "latencyBands",
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const y = scales.y;
    if (!chartArea || !y) {
      return;
    }
    ctx.save();
    for (const band of LATENCY_BANDS) {
      const yTop = y.getPixelForValue(Math.min(band.to, y.max));
      const yBottom = y.getPixelForValue(Math.max(band.from, y.min));
      const top = Math.max(chartArea.top, yTop);
      const bottom = Math.min(chartArea.bottom, yBottom);
      if (bottom <= top) {
        continue;
      }
      ctx.fillStyle = band.color;
      ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
    }

    ctx.strokeStyle = "rgba(126, 164, 222, 0.16)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.font = `9px ${MONO_FONT}`;
    ctx.textAlign = "right";
    for (const line of LATENCY_BAND_LINES) {
      if (line.value > y.max || line.value < y.min) {
        continue;
      }
      const py = y.getPixelForValue(line.value);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, py);
      ctx.lineTo(chartArea.right, py);
      ctx.stroke();
      ctx.fillStyle = "rgba(143, 163, 194, 0.55)";
      ctx.fillText(line.text, chartArea.right - 4, py - 3);
    }
    ctx.restore();
  },
};

/* ---------- window select ---------- */

function getWindowMinutes() {
  return Number(windowSelect.value);
}

function populateWindowOptions(options, defaultWindow) {
  windowSelect.innerHTML = "";
  for (const minutes of options) {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = `${minutes} minutes`;
    windowSelect.appendChild(option);
  }

  const stored = localStorage.getItem(WINDOW_STORAGE_KEY);
  if (stored && options.includes(Number(stored))) {
    windowSelect.value = stored;
    return;
  }
  if (defaultWindow && options.includes(defaultWindow)) {
    windowSelect.value = String(defaultWindow);
  }
}

/* ---------- charts ---------- */

function areaGradient(hex, topAlpha) {
  return (context) => {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) {
      return `${hex}00`;
    }
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, `${hex}${topAlpha}`);
    gradient.addColorStop(1, `${hex}00`);
    return gradient;
  };
}

function initCharts() {
  Chart.defaults.color = "#8fa3c2";
  Chart.defaults.font.family = "'Outfit', 'Segoe UI', system-ui, sans-serif";

  const monoTicks = {
    color: CHART_TICK,
    font: { family: MONO_FONT, size: 10 },
  };

  const tooltipStyle = {
    backgroundColor: "rgba(8, 13, 24, 0.95)",
    borderColor: "rgba(126, 164, 222, 0.25)",
    borderWidth: 1,
    titleColor: "#eaf2ff",
    bodyColor: "#aebed8",
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    titleFont: { family: MONO_FONT, size: 11 },
    bodyFont: { family: MONO_FONT, size: 11 },
  };

  const legendStyle = {
    labels: {
      color: "#aebed8",
      usePointStyle: true,
      boxWidth: 8,
      boxHeight: 8,
      padding: 16,
    },
  };

  const timeScale = {
    type: "time",
    ticks: { ...monoTicks, maxTicksLimit: 8 },
    grid: { color: CHART_GRID },
    bounds: "ticks",
  };

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    scales: {
      x: timeScale,
      y: {
        beginAtZero: true,
        ticks: monoTicks,
        grid: { color: CHART_GRID },
      },
    },
    plugins: {
      legend: legendStyle,
      tooltip: tooltipStyle,
    },
  };

  latencyChart = new Chart(document.getElementById("latency-chart"), {
    type: "line",
    plugins: [latencyBandsPlugin],
    data: {
      datasets: [
        {
          label: "Latency (ms)",
          data: [],
          borderColor: CHART_COLORS.latency,
          backgroundColor: areaGradient(CHART_COLORS.latency, "3d"),
          fill: true,
          borderWidth: 2,
          tension: 0,
          pointRadius: 0,
          spanGaps: false,
        },
        {
          label: "Jitter (ms)",
          data: [],
          borderColor: CHART_COLORS.jitter,
          backgroundColor: CHART_COLORS.jitter,
          fill: false,
          borderWidth: 1.5,
          tension: 0,
          pointRadius: 0,
          spanGaps: false,
        },
        {
          label: "Failed ping",
          data: [],
          showLine: false,
          pointStyle: "rectRot",
          pointRadius: 4,
          pointHoverRadius: 5,
          backgroundColor: CHART_COLORS.fail,
          borderColor: CHART_COLORS.fail,
        },
      ],
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          suggestedMax: 120,
          grace: "10%",
        },
      },
    },
  });

  lossChart = new Chart(document.getElementById("loss-chart"), {
    type: "line",
    data: {
      datasets: [
        {
          label: "Rolling packet loss (%)",
          data: [],
          borderColor: CHART_COLORS.loss,
          backgroundColor: areaGradient(CHART_COLORS.loss, "38"),
          stepped: true,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
        },
      ],
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          max: 100,
          ticks: {
            ...monoTicks,
            callback: (value) => `${value}%`,
          },
        },
      },
    },
  });

  latencyBlocksChart = new Chart(document.getElementById("latency-blocks-chart"), {
    type: "candlestick",
    plugins: [qualityCandleColorsPlugin],
    data: {
      datasets: [
        {
          label: "Latency (ms)",
          data: [],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          type: "time",
          time: {
            unit: "minute",
            displayFormats: {
              minute: "HH:mm",
            },
          },
          ticks: { ...monoTicks, maxTicksLimit: 6 },
          grid: { color: CHART_GRID },
          bounds: "ticks",
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "ms",
            color: CHART_TICK,
            font: { family: MONO_FONT, size: 10 },
          },
          ticks: monoTicks,
          grid: { color: CHART_GRID },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          ...tooltipStyle,
          callbacks: {
            label(context) {
              const point = context.raw;
              if (!point) {
                return "No data";
              }

              const quality = badnessToQuality(point.badness ?? 1);
              const lines = [`Quality: ${quality}`];

              if (point.avg != null) {
                lines.push(
                  `Avg: ${point.avg.toFixed(1)} ms`,
                  `Open: ${point.o.toFixed(1)} ms`,
                  `High: ${point.h.toFixed(1)} ms`,
                  `Low: ${point.l.toFixed(1)} ms`,
                  `Close: ${point.c.toFixed(1)} ms`,
                );
              } else if (point.lossPct >= 100) {
                lines.push("All pings failed");
              }

              if (point.jitter != null) {
                lines.push(`Jitter avg: ${point.jitter.toFixed(1)} ms`);
              }
              if (point.lossPct > 0) {
                lines.push(`Packet loss: ${point.lossPct.toFixed(2)}%`);
              }
              return lines;
            },
          },
        },
      },
    },
  });
}

function computeRollingLoss(samples) {
  let failed = 0;
  return samples.map((sample, index) => {
    if (!sample.success) {
      failed += 1;
    }
    return Number(((failed / (index + 1)) * 100).toFixed(2));
  });
}

function chartTimeRange(windowMinutes, latestTs) {
  const endMs = latestTs ? new Date(latestTs).getTime() : Date.now();
  return {
    min: endMs - windowMinutes * 60 * 1000,
    max: endMs,
  };
}

function applyChartTimeRange(chart, range) {
  chart.options.scales.x.min = range.min;
  chart.options.scales.x.max = range.max;
}

function updateBlocksChart(blocksPayload, windowMinutes, latestTs) {
  const buckets = blocksPayload?.buckets ?? [];
  applyChartTimeRange(latencyBlocksChart, chartTimeRange(windowMinutes, latestTs));
  const candleData = buckets
    .filter((bucket) => bucket.sample_count > 0)
    .map((bucket) => {
      const badness = bucketBadness(bucket);
      const hasLatency = bucket.avg_ms != null;

      return {
        x: new Date(bucket.ts_start).getTime(),
        o: hasLatency ? bucket.open_ms : 0,
        h: hasLatency ? bucket.high_ms : 1,
        l: hasLatency ? bucket.low_ms : 0,
        c: hasLatency ? bucket.close_ms : 0,
        avg: bucket.avg_ms,
        jitter: bucket.jitter_avg_ms,
        lossPct: bucket.loss_pct ?? 0,
        badness,
      };
    });

  latencyBlocksChart.data.datasets[0].data = candleData;
  latencyBlocksChart.update("none");
}

function sampleTimestamp(sample) {
  return new Date(sample.ts).getTime();
}

function updateCharts(samples, windowMinutes, latestTs) {
  const range = chartTimeRange(windowMinutes, latestTs);
  applyChartTimeRange(latencyChart, range);
  applyChartTimeRange(lossChart, range);

  const hasServerRollingLoss = samples.some((sample) => sample.rolling_loss_pct != null);

  const latencyData = samples.map((sample) => ({
    x: sampleTimestamp(sample),
    y: sample.success ? sample.latency_ms : null,
  }));
  const jitterData = samples.map((sample) => ({
    x: sampleTimestamp(sample),
    y: sample.jitter_ms ?? null,
  }));
  const failures = samples
    .filter((sample) => !sample.success)
    .map((sample) => ({
      x: sampleTimestamp(sample),
      y: 0,
    }));
  const rollingLoss = hasServerRollingLoss
    ? samples.map((sample) => ({
        x: sampleTimestamp(sample),
        y: sample.rolling_loss_pct ?? 0,
      }))
    : computeRollingLoss(samples).map((value, index) => ({
        x: sampleTimestamp(samples[index]),
        y: value,
      }));

  latencyChart.data.datasets[0].data = latencyData;
  latencyChart.data.datasets[1].data = jitterData;
  latencyChart.data.datasets[2].data = failures;
  latencyChart.update("none");

  lossChart.data.datasets[0].data = rollingLoss;
  lossChart.update("none");
}

/* ---------- window panel ---------- */

function updateSummaryCards(stats) {
  avgLatencyEl.textContent = formatMs(stats.latency_avg_ms);
  minLatencyEl.textContent = formatMs(stats.latency_min_ms);
  maxLatencyEl.textContent = formatMs(stats.latency_max_ms);
  p95LatencyEl.textContent = formatMs(stats.latency_p95_ms);
  avgJitterEl.textContent = formatMs(stats.jitter_avg_ms);
  packetLossEl.textContent = formatPercent(stats.packet_loss_pct);
  uptimePctEl.textContent = formatPercent(stats.uptime_pct);
  sampleCountEl.textContent = String(stats.sample_count);
}

function updateHealthChip(health, stats) {
  const level = health?.level ?? "no_data";
  const label = health?.label ?? "No data";

  healthChip.className = `health-chip health-chip--${level}`;
  healthLabel.textContent = label;

  if (stats.sample_count) {
    const parts = [`${formatPercent(stats.packet_loss_pct)} loss`];
    if (stats.latency_avg_ms != null) {
      parts.push(`${stats.latency_avg_ms.toFixed(1)} ms avg`);
    }
    healthDetail.textContent = parts.join(" · ");
  } else {
    healthDetail.textContent = "";
  }

  if (health?.reasons?.length) {
    healthChip.title = health.reasons.join(", ");
  } else {
    healthChip.removeAttribute("title");
  }
}

function updateRecentTable(samples) {
  const recent = samples.slice(-20).reverse();
  if (!recent.length) {
    recentTable.innerHTML = '<tr><td colspan="4" class="empty">Waiting for data…</td></tr>';
    return;
  }

  recentTable.innerHTML = recent
    .map((sample) => {
      const statusClass = sample.success ? "ok" : "fail";
      const sampleStatus = sample.success ? "OK" : "Failed";
      return `
        <tr>
          <td class="tabular">${formatTime(sample.ts)}</td>
          <td class="tabular">${sample.success ? formatMs(sample.latency_ms) : "—"}</td>
          <td class="tabular">${sample.jitter_ms != null ? formatMs(sample.jitter_ms) : "—"}</td>
          <td><span class="badge ${statusClass}">${sampleStatus}</span></td>
        </tr>
      `;
    })
    .join("");
}

function updateOutagesTable(outages) {
  if (!outages?.length) {
    outagesTable.innerHTML = '<tr><td colspan="5" class="empty">No outages in this window</td></tr>';
    return;
  }

  outagesTable.innerHTML = outages
    .map((outage) => {
      const statusClass = outage.ongoing ? "ongoing" : "resolved";
      const outageStatus = outage.ongoing ? "Ongoing" : "Resolved";
      return `
        <tr>
          <td class="tabular">${formatTime(outage.start_ts)}</td>
          <td class="tabular">${outage.end_ts ? formatTime(outage.end_ts) : "—"}</td>
          <td class="tabular">${formatDuration(outage.duration_seconds)}</td>
          <td class="tabular">${outage.failed_count}</td>
          <td><span class="badge ${statusClass}">${outageStatus}</span></td>
        </tr>
      `;
    })
    .join("");
}

function updateStalenessIndicator() {
  if (!lastUpdatedAt) {
    updatedIndicator.textContent = "—";
    updatedIndicator.className = "updated-indicator";
    return;
  }

  const ageSeconds = Math.floor((Date.now() - lastUpdatedAt) / 1000);
  updatedIndicator.textContent = `Updated ${ageSeconds}s ago`;

  if (ageSeconds >= STALE_ERROR_SECONDS) {
    updatedIndicator.className = "updated-indicator updated-indicator--error";
  } else if (ageSeconds >= STALE_WARN_SECONDS) {
    updatedIndicator.className = "updated-indicator updated-indicator--warn";
  } else {
    updatedIndicator.className = "updated-indicator";
  }
}

/* ---------- data fetching ---------- */

async function fetchMetricsStatus() {
  const response = await fetch("/api/metrics/status");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchConnection() {
  const response = await fetch("/api/connection");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchMetrics() {
  const windowMinutes = getWindowMinutes();
  const response = await fetch(`/api/metrics?windowMinutes=${windowMinutes}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function applyMetrics(payload) {
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
  blocksPanelTitle.textContent = `Latency blocks (last ${windowMins} min)`;
  windowLabel.textContent = String(windowMins);

  updateHero(now);
  updateStatusPanel(now);
  updateIndicators(now);
  updateLiveFeed(now, recentSamples ?? samples);
  updateSummaryCards(stats);
  updateHealthChip(health, stats);
  updateBlocksChart(blocks, windowMins, payload.latest_ts);
  updateCharts(samples, windowMins, payload.latest_ts);
  updateRecentTable(recentSamples ?? samples);
  updateOutagesTable(outages);

  lastUpdatedAt = Date.now();
  updateStalenessIndicator();

  statusText.textContent = samples.length ? "Live" : "Waiting for data…";
  statusIndicator.className = samples.length ? "status live" : "status";
}

async function refreshConnection() {
  try {
    const connection = await fetchConnection();
    connectionLabel.textContent = formatConnection(connection);
  } catch (error) {
    console.error("Failed to refresh connection info", error);
  }
}

async function poll(force = false) {
  try {
    const status = await fetchMetricsStatus();
    const hasNewData = status.latest_ts !== lastSampleTs;

    if (!force && !hasNewData) {
      return;
    }

    const payload = await fetchMetrics();
    lastSampleTs = payload.latest_ts ?? status.latest_ts;
    applyMetrics(payload);
  } catch (error) {
    statusText.textContent = "Connection error";
    statusIndicator.className = "status error";
    console.error(error);
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await poll(false);
    schedulePoll();
  }, pollIntervalMs);
}

function scheduleConnectionRefresh() {
  clearTimeout(connectionTimer);
  connectionTimer = setTimeout(async () => {
    await refreshConnection();
    scheduleConnectionRefresh();
  }, CONNECTION_REFRESH_MS);
}

function scheduleStalenessRefresh() {
  clearInterval(stalenessTimer);
  stalenessTimer = setInterval(updateStalenessIndicator, 1000);
}

async function bootstrap() {
  initCharts();
  initHeartbeat();

  try {
    const configResponse = await fetch("/api/config");
    if (configResponse.ok) {
      const config = await configResponse.json();
      targetLabel.textContent = config.target;
      populateWindowOptions(config.window_options ?? [5, 15, 30, 60, 120], config.default_window_minutes);
      pollIntervalMs = Math.max(250, config.ping_interval_seconds * 1000);
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
  scheduleStalenessRefresh();
}

bootstrap();
