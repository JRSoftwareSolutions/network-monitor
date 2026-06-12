const WINDOW_STORAGE_KEY = "networkMonitor.windowMinutes";
const CONNECTION_REFRESH_MS = 30000;

const windowSelect = document.getElementById("window-select");
const statusIndicator = document.getElementById("status-indicator");
const healthBar = document.getElementById("health-bar");
const healthLabel = document.getElementById("health-label");
const healthDetail = document.getElementById("health-detail");
const targetLabel = document.getElementById("target-label");
const connectionLabel = document.getElementById("connection-label");

const currentLatencyEl = document.getElementById("current-latency");
const avgLatencyEl = document.getElementById("avg-latency");
const avgJitterEl = document.getElementById("avg-jitter");
const packetLossEl = document.getElementById("packet-loss");
const sampleCountEl = document.getElementById("sample-count");
const recentTable = document.getElementById("recent-table");

let latencyChart;
let lossChart;
let latencyBlocksChart;
let pollTimer;
let connectionTimer;
let pollIntervalMs = 1000;
let lastSampleTs = null;

function formatMs(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(1)} ms`;
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
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

const QUALITY_COLORS = {
  good: { fill: "rgba(61, 214, 140, 0.75)", border: "#3dd68c" },
  fair: { fill: "rgba(255, 176, 32, 0.75)", border: "#ffb020" },
  poor: { fill: "rgba(255, 107, 107, 0.75)", border: "#ff6b6b" },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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
    args.meta.data.forEach((_element, index) => {
      const context = { dataset, dataIndex: index };
      const fill = candleQualityColors(context, true);
      const border = candleQualityColors(context, false);
      const colors = { up: fill, down: fill, unchanged: fill };
      const borders = { up: border, down: border, unchanged: border };

      _element.options.backgroundColors = colors;
      _element.options.borderColors = borders;
    });
  },
};

function getWindowMinutes() {
  return Number(windowSelect.value);
}

function restoreWindowSelection(defaultWindow) {
  const stored = localStorage.getItem(WINDOW_STORAGE_KEY);
  if (stored && [...windowSelect.options].some((option) => option.value === stored)) {
    windowSelect.value = stored;
    return;
  }
  if (defaultWindow) {
    windowSelect.value = String(defaultWindow);
  }
}

function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 8,
          color: "#8b9cb3",
        },
        grid: {
          color: "rgba(45, 58, 79, 0.6)",
        },
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: "#8b9cb3",
        },
        grid: {
          color: "rgba(45, 58, 79, 0.6)",
        },
      },
    },
    plugins: {
      legend: {
        labels: {
          color: "#e7ecf3",
        },
      },
    },
  };

  latencyChart = new Chart(document.getElementById("latency-chart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Latency (ms)",
          data: [],
          borderColor: "#4da3ff",
          backgroundColor: "rgba(77, 163, 255, 0.15)",
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false,
        },
        {
          label: "Jitter (ms)",
          data: [],
          borderColor: "#ffb020",
          backgroundColor: "rgba(255, 176, 32, 0.12)",
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false,
        },
      ],
    },
    options: commonOptions,
  });

  lossChart = new Chart(document.getElementById("loss-chart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Rolling packet loss (%)",
          data: [],
          borderColor: "#ff6b6b",
          backgroundColor: "rgba(255, 107, 107, 0.15)",
          stepped: true,
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
          ticks: {
            maxTicksLimit: 6,
            color: "#8b9cb3",
          },
          grid: {
            color: "rgba(45, 58, 79, 0.6)",
          },
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "ms",
            color: "#8b9cb3",
          },
          ticks: {
            color: "#8b9cb3",
          },
          grid: {
            color: "rgba(45, 58, 79, 0.6)",
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
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

function updateSummaryCards(samples, stats) {
  const latest = samples.length ? samples[samples.length - 1] : null;
  currentLatencyEl.textContent = latest && latest.success ? formatMs(latest.latency_ms) : "—";
  avgLatencyEl.textContent = formatMs(stats.latency_avg_ms);
  avgJitterEl.textContent = formatMs(stats.jitter_avg_ms);
  packetLossEl.textContent = formatPercent(stats.packet_loss_pct);
  sampleCountEl.textContent = String(stats.sample_count);
}

function formatHealthDetail(stats, windowMinutes) {
  if (!stats.sample_count) {
    return "Waiting for samples in the selected window…";
  }

  const parts = [formatPercent(stats.packet_loss_pct) + " loss"];

  if (stats.latency_avg_ms != null) {
    parts.push(`${stats.latency_avg_ms.toFixed(1)} ms avg`);
  }

  if (stats.jitter_avg_ms != null) {
    parts.push(`${stats.jitter_avg_ms.toFixed(1)} ms jitter`);
  }

  parts.push(`${windowMinutes} min window`);
  return parts.join(" · ");
}

function updateHealthBar(health, stats, windowMinutes) {
  const level = health?.level ?? "no_data";
  const label = health?.label ?? "No data";

  healthBar.className = `health-bar health-bar--${level}`;
  healthLabel.textContent = label;
  healthDetail.textContent = formatHealthDetail(stats, windowMinutes);

  if (health?.reasons?.length) {
    healthBar.title = health.reasons.join(", ");
  } else {
    healthBar.removeAttribute("title");
  }
}

function updateBlocksChart(blocksPayload) {
  const buckets = blocksPayload?.buckets ?? [];
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

function updateCharts(samples) {
  const labels = samples.map((sample) => formatTime(sample.ts));
  const latencies = samples.map((sample) => (sample.success ? sample.latency_ms : null));
  const jitters = samples.map((sample) => sample.jitter_ms ?? null);
  const rollingLoss = computeRollingLoss(samples);

  latencyChart.data.labels = labels;
  latencyChart.data.datasets[0].data = latencies;
  latencyChart.data.datasets[1].data = jitters;
  latencyChart.update("none");

  lossChart.data.labels = labels;
  lossChart.data.datasets[0].data = rollingLoss;
  lossChart.update("none");
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
      const statusText = sample.success ? "OK" : "Failed";
      return `
        <tr>
          <td>${formatTime(sample.ts)}</td>
          <td>${sample.success ? formatMs(sample.latency_ms) : "—"}</td>
          <td>${sample.jitter_ms != null ? formatMs(sample.jitter_ms) : "—"}</td>
          <td><span class="badge ${statusClass}">${statusText}</span></td>
        </tr>
      `;
    })
    .join("");
}

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
  const { samples, stats, blocks, health, window_minutes: windowMinutes } = payload;

  updateSummaryCards(samples, stats);
  updateHealthBar(health, stats, windowMinutes ?? getWindowMinutes());
  updateBlocksChart(blocks);
  updateCharts(samples);
  updateRecentTable(samples);

  statusIndicator.textContent = samples.length ? "Live" : "Waiting for data…";
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
    statusIndicator.textContent = "Connection error";
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

async function bootstrap() {
  initCharts();

  try {
    const configResponse = await fetch("/api/config");
    if (configResponse.ok) {
      const config = await configResponse.json();
      targetLabel.textContent = config.target;
      restoreWindowSelection(config.default_window_minutes);
      pollIntervalMs = Math.max(100, config.ping_interval_seconds * 1000);
    }
  } catch (error) {
    console.error("Failed to load config", error);
  }

  windowSelect.addEventListener("change", () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, windowSelect.value);
    poll(true);
  });

  await Promise.all([poll(true), refreshConnection()]);
  schedulePoll();
  scheduleConnectionRefresh();
}

bootstrap();
