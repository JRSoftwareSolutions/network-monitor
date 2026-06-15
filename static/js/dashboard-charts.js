/* ---------- dashboard Chart.js wiring ---------- */

window.DashboardCharts = (() => {
  const F = window.DashboardFormat;
  const R = window.DashboardRating;
  const { hhmm } = F;
  const { COLORS, TICK, GRID } = R;

  const charts = {};
  let chartResizeObserver = null;

  function chartForCanvas(canvas) {
    if (!canvas) return null;
    return Object.values(charts).find((chart) => chart?.canvas === canvas) ?? null;
  }

  function resizeChartToParent(chart) {
    if (!chart?.canvas?.parentNode) return;
    const parent = chart.canvas.parentNode;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width <= 0 || height <= 0) return;
    chart.resize(width, height);
  }

  function resizeChartIn(container) {
    const canvas = container?.querySelector?.("canvas") ?? container;
    const chart = chartForCanvas(canvas);
    if (chart) resizeChartToParent(chart);
  }

  function bindChartResizeObservers() {
    if (typeof ResizeObserver === "undefined") return;
    chartResizeObserver?.disconnect();
    chartResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        resizeChartIn(entry.target);
      }
    });
    const targets = new Set();
    for (const wrap of document.querySelectorAll(".chart-wrap")) {
      targets.add(wrap);
      const panel = wrap.closest("[data-panel]");
      if (panel) targets.add(panel);
    }
    for (const target of targets) {
      chartResizeObserver.observe(target);
    }
  }

  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = TICK;
    Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.animation = { duration: 350 };
  }

  const baseTimeScale = () => ({
    type: "time",
    time: { unit: "minute", tooltipFormat: "HH:mm:ss", displayFormats: { minute: "HH:mm", hour: "HH:mm" } },
    grid: { color: GRID, drawTicks: false },
    border: { display: false },
    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
  });

  function initCharts($) {
    chartDefaults();
    if (!window.Chart) return;

    charts.latency = new Chart($("latency-chart"), {
      type: "line",
      data: { datasets: [
        { label: "latency", data: [], borderColor: COLORS.good, backgroundColor: "rgba(78,200,255,0.10)",
          borderWidth: 1, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false },
        { label: "baseline", data: [], borderColor: COLORS.none, borderWidth: 0.8, borderDash: [5, 5],
          pointRadius: 0, fill: false, spanGaps: true },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: {
          x: baseTimeScale(),
          y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, title: { display: true, text: "ms" } },
        },
        plugins: { legend: { display: true, labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } } },
      },
    });

    charts.jitter = new Chart($("jitter-chart"), {
      type: "line",
      data: { datasets: [{ label: "jitter", data: [], borderColor: COLORS.okay,
        backgroundColor: "rgba(255,200,97,0.12)", borderWidth: 1, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: { x: baseTimeScale(), y: { beginAtZero: true, grid: { color: GRID }, border: { display: false } } },
        plugins: { legend: { display: false } },
      },
    });

    charts.loss = new Chart($("loss-chart"), {
      type: "bar",
      data: { labels: [], datasets: [{ label: "loss %", data: [], backgroundColor: [], borderRadius: 3, maxBarThickness: 26 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true, max: 100, grid: { color: GRID }, border: { display: false }, ticks: { callback: (v) => v + "%" } },
        },
        plugins: { legend: { display: false } },
      },
    });

    charts.distribution = new Chart($("distribution-chart"), {
      type: "bar",
      data: { labels: ["great", "good", "okay", "bad", "failed"],
        datasets: [{ data: [0, 0, 0, 0, 0],
          backgroundColor: [COLORS.great, COLORS.good, COLORS.okay, COLORS.bad, COLORS.offline],
          borderRadius: 5, maxBarThickness: 56 }] },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: "y",
        scales: {
          x: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { precision: 0 } },
          y: { grid: { display: false }, border: { display: false } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.x} pings` } } },
      },
    });

    bindChartResizeObservers();
  }

  function mergeRecentIntoLineSamples(samples, recent) {
    if (!recent.length) return samples || [];
    if (!samples?.length) return recent;

    let base = samples;
    let lastChartMs = new Date(base[base.length - 1].ts).valueOf();
    const recentLatestMs = new Date(recent[recent.length - 1].ts).valueOf();

    if (lastChartMs > recentLatestMs) {
      const trimIdx = base.findIndex((s) => new Date(s.ts).valueOf() > recentLatestMs);
      if (trimIdx >= 0) base = base.slice(0, trimIdx);
      if (!base.length) return recent;
      lastChartMs = new Date(base[base.length - 1].ts).valueOf();
    }

    const newer = recent.filter((s) => new Date(s.ts).valueOf() > lastChartMs);
    if (newer.length) return base.concat(newer);

    const lastRecent = recent[recent.length - 1];
    if (lastRecent && new Date(lastRecent.ts).valueOf() === lastChartMs) {
      return base.slice(0, -1).concat([lastRecent]);
    }

    const tail = recent.filter((s) => new Date(s.ts).valueOf() >= lastChartMs);
    if (tail.length) return base.slice(0, -1).concat(tail);

    return base;
  }

  function trimSamplesToWindow(samples, windowMinutes, endTs) {
    if (!windowMinutes || !samples?.length) return samples || [];
    const endMs = endTs
      ? new Date(endTs).valueOf()
      : new Date(samples[samples.length - 1].ts).valueOf();
    const cutoff = endMs - windowMinutes * 60 * 1000;
    return samples.filter((s) => new Date(s.ts).valueOf() >= cutoff);
  }

  function chartLineSamples(payload) {
    const merged = mergeRecentIntoLineSamples(
      payload.samples || [],
      payload.recent_samples || [],
    );
    const windowMinutes = payload.window_minutes ?? null;
    const endTs = payload.latest_ts
      ?? merged.at(-1)?.ts
      ?? payload.recent_samples?.at(-1)?.ts;
    return trimSamplesToWindow(merged, windowMinutes, endTs);
  }

  function syncLineChartTimeScale(chart, lineSamples, windowMinutes) {
    const x = chart?.options?.scales?.x;
    if (!x) return;
    if (!lineSamples.length) {
      delete x.min;
      delete x.max;
      return;
    }
    const endMs = new Date(lineSamples[lineSamples.length - 1].ts).valueOf();
    if (windowMinutes != null) {
      x.min = endMs - windowMinutes * 60 * 1000;
      x.max = endMs;
      return;
    }
    x.min = new Date(lineSamples[0].ts).valueOf();
    x.max = endMs;
  }

  function updateTimeSeriesLineChart(chart, lineSamples, windowMinutes, yValue) {
    chart.data.datasets[0].data = lineSamples.map((s) => ({
      x: new Date(s.ts).valueOf(),
      y: yValue(s),
    }));
    syncLineChartTimeScale(chart, lineSamples, windowMinutes);
    chart.update("none");
  }

  const EMPTY_DISTRIBUTION = { great: 0, good: 0, okay: 0, bad: 0, failed: 0 };

  function updateCharts(payload) {
    if (!window.Chart) return;
    const lineSamples = chartLineSamples(payload);
    const windowMinutes = payload.window_minutes ?? null;
    const now = payload.now || {};

    if (charts.latency) {
      updateTimeSeriesLineChart(
        charts.latency,
        lineSamples,
        windowMinutes,
        (s) => (s.success ? s.latency_ms : null),
      );
      const baseline = now.baseline_ms;
      if (baseline != null && lineSamples.length) {
        charts.latency.data.datasets[1].data = [
          { x: new Date(lineSamples[0].ts).valueOf(), y: baseline },
          { x: new Date(lineSamples[lineSamples.length - 1].ts).valueOf(), y: baseline },
        ];
        charts.latency.update("none");
      } else {
        charts.latency.data.datasets[1].data = [];
        charts.latency.update("none");
      }
    }

    if (charts.jitter) {
      updateTimeSeriesLineChart(
        charts.jitter,
        lineSamples,
        windowMinutes,
        (s) => (s.success ? (s.jitter_ms ?? null) : null),
      );
    }

    if (charts.loss) {
      const buckets = (payload.blocks || { buckets: [] }).buckets || [];
      charts.loss.data.labels = buckets.map((b) => hhmm(b.ts_start));
      charts.loss.data.datasets[0].data = buckets.map((b) => b.sample_count ? b.loss_pct : 0);
      charts.loss.data.datasets[0].backgroundColor = buckets.map((b) => {
        const l = b.loss_pct || 0;
        return l > 3 ? COLORS.bad : l >= 1 ? COLORS.okay : COLORS.great;
      });
      charts.loss.update("none");
    }

    if (charts.distribution) {
      const dist = payload.latency_distribution || EMPTY_DISTRIBUTION;
      charts.distribution.data.datasets[0].data = [
        dist.great, dist.good, dist.okay, dist.bad, dist.failed,
      ];
      charts.distribution.update("none");
    }
  }

  function resizeCharts() {
    for (const chart of Object.values(charts)) {
      if (chart) resizeChartToParent(chart);
    }
  }

  function redrawCharts() {
    for (const chart of Object.values(charts)) {
      chart?.update("none");
    }
  }

  function chartsHaveDimensions() {
    for (const wrap of document.querySelectorAll(".chart-wrap")) {
      if (wrap.clientWidth <= 0 || wrap.clientHeight <= 0) return false;
    }
    return true;
  }

  function layoutSettledRefresh(callback) {
    const deadline = performance.now() + 300;
    function step() {
      resizeCharts();
      if (!chartsHaveDimensions() && performance.now() < deadline) {
        requestAnimationFrame(step);
        return;
      }
      callback?.();
    }
    requestAnimationFrame(step);
  }

  return {
    initCharts,
    updateCharts,
    chartLineSamples,
    resizeCharts,
    redrawCharts,
    layoutSettledRefresh,
    mergeRecentIntoLineSamples,
    trimSamplesToWindow,
  };
})();
