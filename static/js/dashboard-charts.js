/* ---------- dashboard Chart.js wiring ---------- */

window.DashboardCharts = (() => {
  const F = window.DashboardFormat;
  const R = window.DashboardRating;
  const { fmtMs, hhmm } = F;
  const { COLORS, TICK, GRID, ratePing, bucketQuality } = R;

  const charts = {};

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
          borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false },
        { label: "baseline", data: [], borderColor: COLORS.none, borderWidth: 1.3, borderDash: [5, 5],
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
        backgroundColor: "rgba(255,200,97,0.12)", borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false }] },
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

    charts.blocks = new Chart($("blocks-chart"), {
      type: "bar",
      data: { labels: [], datasets: [{ label: "avg latency", data: [], backgroundColor: [], borderRadius: 2, maxBarThickness: 14 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, title: { display: true, text: "avg ms" } },
        },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: (c) => `avg ${fmtMs(c.parsed.y)} ms` } } },
      },
    });
  }

  function chartLineSamples(payload) {
    const downsampled = payload.samples || [];
    const recent = payload.recent_samples || [];
    const rawCount = payload.sample_count_raw ?? downsampled.length;
    if (!recent.length || rawCount <= downsampled.length) return downsampled;
    if (!downsampled.length) return recent;

    const lastBucketMs = new Date(downsampled[downsampled.length - 1].ts).valueOf();
    const tail = recent.filter((s) => new Date(s.ts).valueOf() >= lastBucketMs);
    if (!tail.length) return downsampled;
    return downsampled.slice(0, -1).concat(tail);
  }

  function updateCharts(payload) {
    if (!window.Chart) return;
    const lineSamples = chartLineSamples(payload);
    const blocks = payload.blocks || { buckets: [] };
    const now = payload.now || {};

    if (charts.latency) {
      const points = lineSamples.map((s) => ({ x: new Date(s.ts).valueOf(), y: s.success ? s.latency_ms : null }));
      charts.latency.data.datasets[0].data = points;
      const baseline = now.baseline_ms;
      if (baseline != null && lineSamples.length) {
        charts.latency.data.datasets[1].data = [
          { x: new Date(lineSamples[0].ts).valueOf(), y: baseline },
          { x: new Date(lineSamples[lineSamples.length - 1].ts).valueOf(), y: baseline },
        ];
      } else {
        charts.latency.data.datasets[1].data = [];
      }
      charts.latency.update("none");
    }

    if (charts.jitter) {
      charts.jitter.data.datasets[0].data = lineSamples.map((s) => ({
        x: new Date(s.ts).valueOf(),
        y: s.jitter_ms ?? null,
      }));
      charts.jitter.update("none");
    }

    const samples = payload.samples || [];

    if (charts.loss) {
      const buckets = blocks.buckets || [];
      charts.loss.data.labels = buckets.map((b) => hhmm(b.ts_start));
      charts.loss.data.datasets[0].data = buckets.map((b) => b.sample_count ? b.loss_pct : 0);
      charts.loss.data.datasets[0].backgroundColor = buckets.map((b) => {
        const l = b.loss_pct || 0;
        return l > 3 ? COLORS.bad : l >= 1 ? COLORS.okay : COLORS.great;
      });
      charts.loss.update("none");
    }

    if (charts.distribution) {
      const counts = { great: 0, good: 0, okay: 0, bad: 0, failed: 0 };
      for (const s of samples) {
        if (!s.success || s.latency_ms == null) counts.failed++;
        else counts[ratePing(s.latency_ms)]++;
      }
      charts.distribution.data.datasets[0].data = [counts.great, counts.good, counts.okay, counts.bad, counts.failed];
      charts.distribution.update("none");
    }

    if (charts.blocks) {
      const buckets = blocks.buckets || [];
      charts.blocks.data.labels = buckets.map((b) => hhmm(b.ts_start));
      charts.blocks.data.datasets[0].data = buckets.map((b) => b.avg_ms ?? null);
      charts.blocks.data.datasets[0].backgroundColor = buckets.map((b) => {
        const q = bucketQuality(b);
        return q === "poor" ? COLORS.bad : q === "fair" ? COLORS.okay : q === "good" ? COLORS.great : GRID;
      });
      charts.blocks.update("none");
    }
  }

  function resizeCharts() {
    for (const chart of Object.values(charts)) {
      chart?.resize();
    }
  }

  return {
    initCharts,
    updateCharts,
    resizeCharts,
  };
})();
