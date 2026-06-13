const WINDOW_STORAGE_KEY = "networkMonitor.windowMinutes";
const FILL_MODE_STORAGE_KEY = "networkMonitor.fillMode";
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
