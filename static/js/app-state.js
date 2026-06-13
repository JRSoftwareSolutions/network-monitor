// Refresh timings are defaults only: /api/config overrides them at bootstrap
// and whenever settings are saved.
let CONNECTION_REFRESH_MS = 120000;
let FULL_REFRESH_MS = 60000;
let HIDDEN_POLL_MULTIPLIER = 10;

/* ---------- dom refs ---------- */

const windowSelect = document.getElementById("window-select");
const viewSelect = document.getElementById("view-select");
const screenshotBtn = document.getElementById("screenshot-btn");
const screenshotRangeSelect = document.getElementById("screenshot-range");
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
const blocksPanelSubtitle = document.getElementById("blocks-panel-subtitle");
const heroKicker = document.getElementById("hero-kicker");
const verdictDetailLive = document.getElementById("verdict-detail-live");
const windowSummaryDetail = document.getElementById("window-summary-detail");
const windowSummaryNarrative = document.getElementById("window-summary-narrative");
const readoutCaption = document.getElementById("readout-caption");
const qualityTimeline = document.getElementById("quality-timeline");
const qualityBreakdownLegend = document.getElementById("quality-breakdown-legend");
const breakdownGood = document.getElementById("breakdown-good");
const breakdownFair = document.getElementById("breakdown-fair");
const breakdownPoor = document.getElementById("breakdown-poor");
const breakdownEmpty = document.getElementById("breakdown-empty");
const distributionInsight = document.getElementById("distribution-insight");
const worstMinutesTable = document.getElementById("worst-minutes-table");
const bestMinutesTable = document.getElementById("best-minutes-table");
const minuteLogTable = document.getElementById("minute-log-table");
const insightPeakLatency = document.getElementById("insight-peak-latency");
const insightPeakMinute = document.getElementById("insight-peak-minute");
const insightBestMinute = document.getElementById("insight-best-minute");
const insightTotalDowntime = document.getElementById("insight-total-downtime");
const insightOutageCount = document.getElementById("insight-outage-count");
const insightHealthReasons = document.getElementById("insight-health-reasons");
const historyPieCaptions = {
  latency: document.getElementById("history-latency-pie-caption"),
  jitter: document.getElementById("history-jitter-pie-caption"),
  loss: document.getElementById("history-loss-pie-caption"),
  quality: document.getElementById("history-quality-pie-caption"),
};

let latencyChart;
let jitterChart;
let lossChart;
let latencyBlocksChart;
let distributionChart;
let historyLatencyPie;
let historyJitterPie;
let historyLossPie;
let historyQualityPie;
let pollTimer;
let connectionTimer;
let stalenessTimer;
let pollIntervalMs = 1000;
let lastSampleTs = null;
let lastUpdatedAt = null;
let lastFullRefreshAt = null;
let lastFaviconLevel = null;
let currentConfig = null;
let lastMetricsPayload = null;



