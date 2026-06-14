const WINDOW_STORAGE_KEY = "networkMonitor.windowMinutes";
const DASHBOARD_VIEW_STORAGE_KEY = "networkMonitor.dashboardView";
const PANEL_PREFS_STORAGE_KEY = "networkMonitor.panelPrefs";
const CUSTOM_VIEWS_STORAGE_KEY = "networkMonitor.customViews";
const VIEWS_EXPORT_VERSION = 1;
const SCREENSHOT_RANGE_STORAGE_KEY = "networkMonitor.screenshotRange";
const LAYOUT_PANEL_WIDTH_STORAGE_KEY = "networkMonitor.layoutPanelWidth";

const STALE_WARN_SECONDS = 10;
const STALE_ERROR_SECONDS = 30;
const HEARTBEAT_COUNT = 60;
const HEARTBEAT_MAX_MS = 150;

const HEALTH_TO_RATING = {
  healthy: "great",
  degraded: "okay",
  poor: "bad",
  offline: "offline",
  no_data: "none",
};

const DISTRIBUTION_LABELS = ["great", "good", "okay", "bad", "failed"];

const HISTORY_MINUTE_TABLE_LIMIT = 10;
const HISTORY_RECENT_LIMIT = 30;

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

const RATING_PIE_COLORS = [
  `${LEVEL_COLORS.great}cc`,
  `${LEVEL_COLORS.good}cc`,
  `${LEVEL_COLORS.okay}cc`,
  `${LEVEL_COLORS.bad}cc`,
  `${LEVEL_COLORS.offline}cc`,
];

const QUALITY_PIE_COLORS = [
  "rgba(61, 255, 162, 0.82)",
  "rgba(255, 194, 77, 0.82)",
  "rgba(255, 93, 108, 0.82)",
  "rgba(143, 163, 194, 0.22)",
];

const BLOCKS_PANEL_LIVE = {
  title: (windowMins) => `Latency blocks (last ${windowMins} min)`,
  subtitle: "1-minute candles — green is good, amber is fair, red is poor (latency + jitter + loss)",
};

const BLOCKS_PANEL_HISTORY = {
  title: "Connection quality timeline",
  subtitle: "Each cell = 1 minute · green / amber / red = good / fair / poor",
};

/* Spike detection (mirrors src/metrics_verdict.py) */
const NOW_WINDOW_SECONDS = 120;
const BASELINE_SECONDS = 60;
const MIN_BASELINE_SAMPLES = 5;
const SPIKE_FACTOR = 2.5;
const SPIKE_MIN_DELTA_MS = 80;

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
