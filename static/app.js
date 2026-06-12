const WINDOW_STORAGE_KEY = "networkMonitor.windowMinutes";
const FILL_MODE_STORAGE_KEY = "networkMonitor.fillMode";
// Refresh timings are defaults only: /api/config overrides them at bootstrap
// and whenever settings are saved.
let CONNECTION_REFRESH_MS = 120000;
let FULL_REFRESH_MS = 60000;
let HIDDEN_POLL_MULTIPLIER = 10;
const STALE_WARN_SECONDS = 10;
const STALE_ERROR_SECONDS = 30;
const HEARTBEAT_COUNT = 60;
const HEARTBEAT_MAX_MS = 150;

/* ---------- dom refs ---------- */

const windowSelect = document.getElementById("window-select");
const fillModeToggle = document.getElementById("fill-mode-toggle");
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
let jitterChart;
let lossChart;
let latencyBlocksChart;
let pollTimer;
let connectionTimer;
let stalenessTimer;
let pollIntervalMs = 1000;
let lastSampleTs = null;
let lastUpdatedAt = null;
let lastFullRefreshAt = null;
let lastFaviconLevel = null;
let currentConfig = null;

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

function rateOutageDuration(seconds) {
  if (seconds < 30) {
    return "okay";
  }
  if (seconds < 120) {
    return "bad";
  }
  return "offline";
}

function rateOutageFailures(count) {
  if (count <= 5) {
    return "okay";
  }
  if (count <= 20) {
    return "bad";
  }
  return "offline";
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

const METRIC_HELP = {
  ping: {
    title: "Ping",
    paragraphs: [
      "Your typical round-trip latency to the target — the steady response time you'd normally feel in-game, not a single momentary reading.",
      "Calculated as the median of successful pings over the last 60 seconds. Short spikes barely move this number, so it reflects your baseline rather than one-off blips.",
    ],
    thresholds: "Great &lt; 40 ms · Good &lt; 70 ms · Okay &lt; 110 ms · Bad ≥ 110 ms",
  },
  jitter: {
    title: "Jitter",
    paragraphs: [
      "How much your ping wobbles from one packet to the next. Low jitter means steady timing; high jitter feels like stutter or rubber-banding even when average ping looks fine.",
      "Average inter-arrival jitter (RFC 3550-style smoothing) across successful pings in the last 2 minutes.",
    ],
    thresholds: "Great &lt; 8 ms · Good &lt; 15 ms · Okay &lt; 30 ms · Bad ≥ 30 ms",
  },
  loss: {
    title: "Packet loss",
    paragraphs: [
      "The share of ping requests that never got a reply. Dropped packets make actions arrive late or not at all — you'll notice it as hitches, desync, or abilities misfiring.",
      "Failed pings divided by total pings in the last 2 minutes.",
    ],
    thresholds: "Great 0% · Good &lt; 1% · Okay ≤ 3% · Bad &gt; 3%",
  },
  spikes: {
    title: "Spike rate",
    paragraphs: [
      "How often latency suddenly shoots far above your normal baseline. A single bad ping is a micro-hitch; frequent spikes feel like ongoing rubber-banding.",
      "Counts pings that exceed max(2.5× baseline, baseline + 80 ms) in the last 2 minutes, then expresses that as spikes per minute. The rating follows the rate, not the single worst value.",
    ],
    thresholds: "Great 0/min · Good &lt; 1/min · Okay ≤ 4/min · Bad &gt; 4/min",
  },
};

const CHART_HELP = {
  "live-feed": {
    title: "Live feed",
    paragraphs: [
      "The raw, unfiltered view of what's happening right now. The big number is the latest ping, and each bar in the strip is one ping — the last 60, newest on the right. Taller bars mean higher latency; a full-height red bar is a ping that never came back.",
      "Nothing here is smoothed or damped, so this row is allowed to jump around. The instant chip reads only the last few pings — treat it as a gut check, not a verdict.",
    ],
    thresholds: "Bar colors: great &lt; 40 ms · good &lt; 70 ms · fair &lt; 110 ms · poor ≥ 110 ms · red = failed",
  },
  "latency-blocks": {
    title: "Latency blocks",
    paragraphs: [
      "Each candle condenses one minute of pings, stock-chart style: the thin wick spans the lowest to highest latency in that minute, and the thick body runs from the first reading (open) to the last (close).",
      "Color grades the whole minute by blending packet loss, average latency and jitter — so a minute can turn amber or red from loss alone even when latency looks fine. Hover a candle for the exact numbers.",
    ],
    thresholds: "Green = good · amber = fair · red = poor — weighted blend: loss 50% · latency 35% · jitter 15%",
  },
  latency: {
    title: "Latency",
    paragraphs: [
      "Every ping's round-trip time across the selected window. The purple band hugging the line shows ±jitter at that moment — the wider the band, the less steady the connection.",
      "Shaded horizontal zones in the background mark the quality thresholds, and thin red vertical strips mark pings that failed and therefore have no latency value.",
    ],
    thresholds: "Zones: great &lt; 40 ms · good &lt; 70 ms · fair &lt; 110 ms · poor ≥ 110 ms",
  },
  "jitter-chart": {
    title: "Jitter",
    paragraphs: [
      "How much the timing between pings wobbles, plotted per ping. A line hugging zero means packets arrive on a steady beat; rising jitter feels like stutter or rubber-banding even when average ping looks fine.",
      "Values use the same RFC 3550-style smoothing as the jitter indicator above, so a single odd packet won't spike the line.",
    ],
    thresholds: "Zones: great &lt; 8 ms · good &lt; 15 ms · fair &lt; 30 ms · poor ≥ 30 ms",
  },
  "loss-chart": {
    title: "Packet loss",
    paragraphs: [
      "The share of pings that went unanswered, bucketed per minute — one bar per minute, taller is worse. Minutes with no loss show no bar at all.",
      "Bar color reflects severity, and the dashed reference lines mark where loss starts to be noticeable. Hover a bar to see exactly how many pings failed.",
    ],
    thresholds: "Good &lt; 1% · fair ≤ 3% · poor &gt; 3%",
  },
};

const HELP_CONTENT = { ...METRIC_HELP, ...CHART_HELP };

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

/* ---------- metric help popover ---------- */

const metricPopover = document.getElementById("metric-popover");
const metricPopoverTitle = document.getElementById("metric-popover-title");
const metricPopoverBody = document.getElementById("metric-popover-body");
const metricPopoverPanel = metricPopover?.querySelector(".metric-popover__panel");
const metricPopoverClose = metricPopover?.querySelector(".metric-popover__close");
const metricPopoverBackdrop = metricPopover?.querySelector(".metric-popover__backdrop");
let activeHelpKey = null;
let activeHelpTrigger = null;

const THRESHOLD_LEVEL_WORDS = {
  great: "great",
  good: "good",
  okay: "okay",
  fair: "okay",
  poor: "bad",
  bad: "bad",
  green: "good",
  amber: "okay",
  red: "bad",
};

function colorizeThresholdText(text) {
  let html = text.replace(
    /\b(Great|Good|Okay|Bad|great|good|fair|poor|Green|amber|red)(?=\s|[<≥≤=·]|$)/gi,
    (match) => {
      const level = THRESHOLD_LEVEL_WORDS[match.toLowerCase()];
      if (!level) return match;
      return `<span class="metric-popover__lvl metric-popover__lvl--${level}">${match}</span>`;
    },
  );
  html = html.replace(
    /\bfailed\b/gi,
    '<span class="metric-popover__lvl metric-popover__lvl--bad">failed</span>',
  );
  return html;
}

function renderMetricHelpBody(help) {
  const parts = help.paragraphs.map((text) => `<p>${text}</p>`);
  if (help.thresholds) {
    parts.push(`<p class="metric-popover__thresholds">${colorizeThresholdText(help.thresholds)}</p>`);
  }
  metricPopoverBody.innerHTML = parts.join("");
}

function positionMetricPopover(trigger) {
  if (!metricPopoverPanel || !trigger) return;

  const rect = trigger.getBoundingClientRect();
  const panelRect = metricPopoverPanel.getBoundingClientRect();
  const margin = 12;
  const gap = 10;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let top = rect.bottom + gap;
  if (top + panelRect.height > viewportH - margin) {
    top = rect.top - panelRect.height - gap;
  }
  top = Math.max(margin, Math.min(top, viewportH - panelRect.height - margin));

  let left = rect.left + rect.width / 2 - panelRect.width / 2;
  left = Math.max(margin, Math.min(left, viewportW - panelRect.width - margin));

  metricPopoverPanel.style.top = `${top}px`;
  metricPopoverPanel.style.left = `${left}px`;
}

function setMetricHelpExpanded(trigger, expanded) {
  if (!trigger) return;
  trigger.setAttribute("aria-expanded", String(expanded));
}

function closeMetricPopover() {
  if (!metricPopover || metricPopover.hidden) return;
  metricPopover.hidden = true;
  setMetricHelpExpanded(activeHelpTrigger, false);
  activeHelpKey = null;
  activeHelpTrigger = null;
}

function openMetricPopover(key, trigger) {
  const help = HELP_CONTENT[key];
  if (!help || !metricPopover || !trigger) return;

  if (activeHelpKey === key && !metricPopover.hidden) {
    closeMetricPopover();
    return;
  }

  if (activeHelpTrigger && activeHelpTrigger !== trigger) {
    setMetricHelpExpanded(activeHelpTrigger, false);
  }

  activeHelpKey = key;
  activeHelpTrigger = trigger;
  metricPopoverTitle.textContent = help.title;
  renderMetricHelpBody(help);

  const rating = key in INDICATOR_DECIMALS
    ? indicatorEls[key]?.root?.dataset.rating
    : null;
  if (rating && rating !== "none") {
    metricPopoverPanel.dataset.rating = rating;
  } else {
    delete metricPopoverPanel.dataset.rating;
  }

  metricPopover.hidden = false;
  setMetricHelpExpanded(trigger, true);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => positionMetricPopover(trigger));
  });
}

function initHelpPopovers() {
  if (!metricPopover) return;

  for (const key of Object.keys(INDICATOR_DECIMALS)) {
    const trigger = indicatorEls[key]?.root;
    if (!trigger) continue;

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      openMetricPopover(key, trigger);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMetricPopover(key, trigger);
      }
    });
  }

  // Native buttons already fire click on Enter/Space, so no keydown handler needed.
  for (const button of document.querySelectorAll(".panel-help-btn[data-help]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openMetricPopover(button.dataset.help, button);
    });
  }

  metricPopoverClose?.addEventListener("click", closeMetricPopover);
  metricPopoverBackdrop?.addEventListener("click", closeMetricPopover);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMetricPopover();
  });

  window.addEventListener("resize", () => {
    if (!metricPopover.hidden) positionMetricPopover(activeHelpTrigger);
  });
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

/* ---------- threshold band backgrounds (latency / jitter / loss) ---------- */

function makeThresholdBandsPlugin(id, bands, lines) {
  return {
    id,
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const y = scales.y;
      if (!chartArea || !y) {
        return;
      }
      ctx.save();
      for (const band of bands) {
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
      for (const line of lines) {
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
}

const latencyBandsPlugin = makeThresholdBandsPlugin(
  "latencyBands",
  [
    { from: 0, to: 40, color: "rgba(61, 255, 162, 0.045)" },
    { from: 40, to: 70, color: "rgba(79, 209, 255, 0.035)" },
    { from: 70, to: 110, color: "rgba(255, 194, 77, 0.05)" },
    { from: 110, to: Infinity, color: "rgba(255, 93, 108, 0.06)" },
  ],
  [
    { value: 40, text: "great <40" },
    { value: 70, text: "good <70" },
    { value: 110, text: "fair <110" },
  ],
);

const jitterBandsPlugin = makeThresholdBandsPlugin(
  "jitterBands",
  [
    { from: 0, to: 8, color: "rgba(61, 255, 162, 0.045)" },
    { from: 8, to: 15, color: "rgba(79, 209, 255, 0.035)" },
    { from: 15, to: 30, color: "rgba(255, 194, 77, 0.05)" },
    { from: 30, to: Infinity, color: "rgba(255, 93, 108, 0.06)" },
  ],
  [
    { value: 8, text: "great <8" },
    { value: 15, text: "good <15" },
    { value: 30, text: "fair <30" },
  ],
);

const lossBandsPlugin = makeThresholdBandsPlugin(
  "lossBands",
  [],
  [
    { value: 1, text: "good <1%" },
    { value: 3, text: "fair ≤3%" },
  ],
);

/* ---------- failed-ping strips on the latency chart ---------- */

const failureStripsPlugin = {
  id: "failureStrips",
  beforeDatasetsDraw(chart) {
    const failures = chart.$failures;
    if (!failures?.length) {
      return;
    }
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    if (!chartArea || !x) {
      return;
    }
    const widthMs = chart.$failureWidthMs ?? 3000;
    ctx.save();
    for (const ts of failures) {
      const px = x.getPixelForValue(ts);
      if (px < chartArea.left || px > chartArea.right) {
        continue;
      }
      const half = Math.max(1, Math.abs(x.getPixelForValue(ts + widthMs) - px) / 2);
      ctx.fillStyle = "rgba(255, 93, 108, 0.16)";
      ctx.fillRect(px - half, chartArea.top, half * 2, chartArea.bottom - chartArea.top);
      ctx.fillStyle = "rgba(255, 93, 108, 0.85)";
      ctx.fillRect(px - 1, chartArea.top, 2, 6);
    }
    ctx.restore();
  },
};

/* ---------- per-minute loss bar colors ---------- */

function lossBarColor(lossPct) {
  if (lossPct < 1) {
    return "rgba(79, 209, 255, 0.7)";
  }
  if (lossPct <= 3) {
    return "rgba(255, 194, 77, 0.8)";
  }
  return "rgba(255, 93, 108, 0.85)";
}

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
    plugins: [latencyBandsPlugin, failureStripsPlugin],
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
          order: 1,
        },
        {
          label: "Jitter band (±)",
          data: [],
          borderColor: "rgba(179, 136, 255, 0)",
          backgroundColor: "rgba(179, 136, 255, 0.18)",
          fill: "+1",
          borderWidth: 0,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          order: 2,
        },
        {
          label: "_jitter-lower",
          data: [],
          borderColor: "rgba(179, 136, 255, 0)",
          backgroundColor: "rgba(179, 136, 255, 0)",
          fill: false,
          borderWidth: 0,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          order: 2,
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
      plugins: {
        legend: {
          ...legendStyle,
          labels: {
            ...legendStyle.labels,
            filter: (item) => !item.text.startsWith("_"),
          },
        },
        tooltip: {
          ...tooltipStyle,
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            afterLabel(context) {
              const jitter = context.raw?.jitter;
              return jitter != null ? `Jitter: ±${jitter.toFixed(1)} ms` : "";
            },
          },
        },
      },
    },
  });

  jitterChart = new Chart(document.getElementById("jitter-chart"), {
    type: "line",
    plugins: [jitterBandsPlugin],
    data: {
      datasets: [
        {
          label: "Jitter (ms)",
          data: [],
          borderColor: CHART_COLORS.jitter,
          backgroundColor: areaGradient(CHART_COLORS.jitter, "38"),
          fill: true,
          borderWidth: 1.5,
          tension: 0,
          pointRadius: 0,
          spanGaps: false,
        },
      ],
    },
    options: {
      ...commonOptions,
      plugins: {
        ...commonOptions.plugins,
        legend: { display: false },
      },
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          suggestedMax: 20,
          grace: "10%",
        },
      },
    },
  });

  lossChart = new Chart(document.getElementById("loss-chart"), {
    type: "bar",
    plugins: [lossBandsPlugin],
    data: {
      datasets: [
        {
          label: "Packet loss per minute (%)",
          data: [],
          backgroundColor: (context) => lossBarColor(context.raw?.y ?? 0),
          borderRadius: 2,
          borderSkipped: false,
          barPercentage: 0.85,
          categoryPercentage: 1,
        },
      ],
    },
    options: {
      ...commonOptions,
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      scales: {
        x: {
          ...timeScale,
          time: {
            unit: "minute",
            displayFormats: { minute: "HH:mm" },
          },
          offset: false,
          grid: { color: CHART_GRID, offset: false },
        },
        y: {
          ...commonOptions.scales.y,
          suggestedMax: 5,
          grace: "10%",
          ticks: {
            ...monoTicks,
            callback: (value) => `${value}%`,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle,
          callbacks: {
            label(context) {
              const point = context.raw;
              if (!point) {
                return "No data";
              }
              const lines = [`Loss: ${point.y.toFixed(1)}%`];
              if (point.total) {
                lines.push(`${point.failed} of ${point.total} pings failed`);
              }
              return lines;
            },
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

  initChartResizeObserver();
}

let chartResizeObserver;

function initChartResizeObserver() {
  chartResizeObserver?.disconnect();
  chartResizeObserver = new ResizeObserver(() => {
    resizeCharts();
  });

  for (const id of ["latency-chart", "jitter-chart", "loss-chart", "latency-blocks-chart"]) {
    const wrap = document.getElementById(id)?.closest(".chart-wrap");
    if (wrap) {
      chartResizeObserver.observe(wrap);
    }
  }
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

/* Median spacing between consecutive samples, used to size failure strips. */
function medianSampleSpacingMs(samples) {
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) {
    const delta = sampleTimestamp(samples[i]) - sampleTimestamp(samples[i - 1]);
    if (delta > 0) {
      deltas.push(delta);
    }
  }
  if (!deltas.length) {
    return 3000;
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function updateCharts(samples, windowMinutes, latestTs) {
  const range = chartTimeRange(windowMinutes, latestTs);
  applyChartTimeRange(latencyChart, range);
  applyChartTimeRange(jitterChart, range);

  const latencyData = [];
  const bandUpper = [];
  const bandLower = [];
  const jitterData = [];
  const failures = [];

  for (const sample of samples) {
    const x = sampleTimestamp(sample);
    const latency = sample.success ? sample.latency_ms : null;
    const jitter = sample.jitter_ms ?? null;

    latencyData.push({ x, y: latency, jitter });
    if (latency != null && jitter != null) {
      bandUpper.push({ x, y: latency + jitter });
      bandLower.push({ x, y: Math.max(0, latency - jitter) });
    } else {
      bandUpper.push({ x, y: null });
      bandLower.push({ x, y: null });
    }
    jitterData.push({ x, y: jitter });
    if (!sample.success) {
      failures.push(x);
    }
  }

  latencyChart.data.datasets[0].data = latencyData;
  latencyChart.data.datasets[1].data = bandUpper;
  latencyChart.data.datasets[2].data = bandLower;
  latencyChart.$failures = failures;
  latencyChart.$failureWidthMs = medianSampleSpacingMs(samples);
  latencyChart.update("none");

  jitterChart.data.datasets[0].data = jitterData;
  jitterChart.update("none");
}

function updateLossChart(blocksPayload, windowMinutes, latestTs) {
  const buckets = blocksPayload?.buckets ?? [];
  const bucketMs = (blocksPayload?.bucket_seconds ?? 60) * 1000;
  applyChartTimeRange(lossChart, chartTimeRange(windowMinutes, latestTs));

  lossChart.data.datasets[0].data = buckets
    .filter((bucket) => bucket.sample_count > 0)
    .map((bucket) => ({
      x: new Date(bucket.ts_start).getTime() + bucketMs / 2,
      y: bucket.loss_pct ?? 0,
      failed: bucket.failed_count,
      total: bucket.sample_count,
    }));
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
      const rowClass = sample.success ? "table-row--success" : "table-row--failure";
      const statusClass = sample.success ? "ok" : "fail";
      const sampleStatus = sample.success ? "OK" : "Failed";
      const latencyRating =
        sample.success && sample.latency_ms != null ? rateMetric("ping", sample.latency_ms) : "none";
      const jitterRating =
        sample.success && sample.jitter_ms != null ? rateMetric("jitter", sample.jitter_ms) : "none";
      return `
        <tr class="${rowClass}">
          <td class="tabular">${formatTime(sample.ts)}</td>
          <td class="tabular cell-rating" data-rating="${latencyRating}">${sample.success ? formatMs(sample.latency_ms) : "—"}</td>
          <td class="tabular cell-rating" data-rating="${jitterRating}">${sample.jitter_ms != null ? formatMs(sample.jitter_ms) : "—"}</td>
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
      const rowClass = outage.ongoing ? "table-row--ongoing" : "table-row--resolved";
      const statusClass = outage.ongoing ? "ongoing" : "resolved";
      const outageStatus = outage.ongoing ? "Ongoing" : "Resolved";
      const durationRating = outage.ongoing ? "offline" : rateOutageDuration(outage.duration_seconds);
      const failureRating = outage.ongoing ? "offline" : rateOutageFailures(outage.failed_count);
      return `
        <tr class="${rowClass}">
          <td class="tabular">${formatTime(outage.start_ts)}</td>
          <td class="tabular">${outage.end_ts ? formatTime(outage.end_ts) : "—"}</td>
          <td class="tabular cell-rating" data-rating="${durationRating}">${formatDuration(outage.duration_seconds)}</td>
          <td class="tabular cell-rating" data-rating="${failureRating}">${outage.failed_count}</td>
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

  updateHero(now);
  updateStatusPanel(now);
  updateIndicators(now);
  updateLiveFeed(now, recentSamples);
  updateRecentTable(recentSamples);

  lastUpdatedAt = Date.now();
  updateStalenessIndicator();

  statusText.textContent = recentSamples?.length ? "Live" : "Waiting for data…";
  statusIndicator.className = recentSamples?.length ? "status live" : "status";
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
  updateLossChart(blocks, windowMins, payload.latest_ts);
  updateRecentTable(recentSamples ?? samples);
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

/* ---------- fill mode ---------- */

let fillModeScrollY = 0;

function resizeCharts() {
  latencyChart?.resize();
  jitterChart?.resize();
  lossChart?.resize();
  latencyBlocksChart?.resize();
}

function setFillMode(enabled, persist = true) {
  if (enabled) {
    fillModeScrollY = window.scrollY;
    window.scrollTo(0, 0);
  }

  document.body.classList.toggle("fill-mode", enabled);
  fillModeToggle.setAttribute("aria-pressed", String(enabled));
  if (persist) {
    localStorage.setItem(FILL_MODE_STORAGE_KEY, enabled ? "1" : "0");
  }

  // Nudge charts after the class toggle; ResizeObserver handles ongoing size changes.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resizeCharts();
      if (!enabled) {
        window.scrollTo(0, fillModeScrollY);
      }
    });
  });
}

function initFillMode() {
  setFillMode(localStorage.getItem(FILL_MODE_STORAGE_KEY) === "1", false);
  fillModeToggle.addEventListener("click", () => {
    setFillMode(!document.body.classList.contains("fill-mode"));
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
  if (!settingsPanel || !settingsToggle) return;

  const rect = settingsToggle.getBoundingClientRect();
  const panelRect = settingsPanel.getBoundingClientRect();
  const margin = 12;
  const gap = 10;

  let top = rect.bottom + gap;
  top = Math.max(margin, Math.min(top, window.innerHeight - panelRect.height - margin));

  let left = rect.right - panelRect.width;
  left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin));

  settingsPanel.style.top = `${top}px`;
  settingsPanel.style.left = `${left}px`;
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
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettings();
  });
  window.addEventListener("resize", () => {
    if (!settingsPopover.hidden) positionSettingsPanel();
  });
}

async function bootstrap() {
  initFillMode();
  initSettings();
  initHelpPopovers();
  initCharts();
  initHeartbeat();

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
