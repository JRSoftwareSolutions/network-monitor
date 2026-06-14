/* ---------- analytics charts ---------- */

function parseSampleTs(ts) {
  return new Date(ts).getTime();
}

function medianValues(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeWindowSpikeEvents(samples) {
  const windowMs = NOW_WINDOW_SECONDS * 1000;
  const baselineMs = BASELINE_SECONDS * 1000;

  const valid = (samples ?? [])
    .filter((sample) => sample.success && sample.latency_ms != null)
    .map((sample) => ({ ...sample, t: parseSampleTs(sample.ts) }))
    .sort((a, b) => a.t - b.t);

  const spikes = [];

  for (let i = 0; i < valid.length; i += 1) {
    const sample = valid[i];
    const windowStart = sample.t - windowMs;
    const baselineStart = sample.t - baselineMs;

    let baselinePool = [];
    for (let j = i; j >= 0; j -= 1) {
      if (valid[j].t < windowStart) {
        break;
      }
      if (valid[j].t >= baselineStart) {
        baselinePool.push(valid[j].latency_ms);
      }
    }

    if (baselinePool.length < MIN_BASELINE_SAMPLES) {
      baselinePool = [];
      for (let j = i; j >= 0; j -= 1) {
        if (valid[j].t < windowStart) {
          break;
        }
        baselinePool.push(valid[j].latency_ms);
      }
    }

    if (!baselinePool.length) {
      continue;
    }

    const baseline = Math.round(medianValues(baselinePool) * 10) / 10;
    const threshold = Math.round(
      Math.max(baseline * SPIKE_FACTOR, baseline + SPIKE_MIN_DELTA_MS) * 10,
    ) / 10;

    if (sample.latency_ms >= threshold) {
      spikes.push({
        x: sample.t,
        y: sample.latency_ms,
        threshold,
        severity: sample.latency_ms / threshold,
        ts: sample.ts,
      });
    }
  }

  return spikes;
}

function buildQualityCompositionData(buckets) {
  const good = [];
  const fair = [];
  const poor = [];
  const empty = [];

  for (const bucket of buckets ?? []) {
    const x = parseSampleTs(bucket.ts_start);
    const hasSamples = (bucket.sample_count ?? 0) > 0;

    if (!hasSamples) {
      good.push({ x, y: 0 });
      fair.push({ x, y: 0 });
      poor.push({ x, y: 0 });
      empty.push({ x, y: 1 });
      continue;
    }

    const quality = badnessToQuality(bucketBadness(bucket));
    good.push({ x, y: quality === "good" ? 1 : 0 });
    fair.push({ x, y: quality === "fair" ? 1 : 0 });
    poor.push({ x, y: quality === "poor" ? 1 : 0 });
    empty.push({ x, y: 0 });
  }

  return { good, fair, poor, empty };
}

function buildLatencyJitterScatterData(samples) {
  return (samples ?? [])
    .filter((sample) => sample.success && sample.latency_ms != null && sample.jitter_ms != null)
    .map((sample) => ({
      x: sample.latency_ms,
      y: sample.jitter_ms,
      rating: rateMetric("ping", sample.latency_ms),
      ts: sample.ts,
    }));
}

function spikePointColor(severity) {
  if (severity >= 2) {
    return `${LEVEL_COLORS.offline}cc`;
  }
  if (severity >= 1.5) {
    return `${LEVEL_COLORS.bad}cc`;
  }
  return `${LEVEL_COLORS.okay}cc`;
}

function scatterPointColor(rating) {
  return `${LEVEL_COLORS[rating] ?? LEVEL_COLORS.no_data}aa`;
}

function initAnalyticsCharts() {
  if (typeof Chart === "undefined") {
    return;
  }

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

  const timeScale = {
    type: "time",
    ticks: { ...monoTicks, maxTicksLimit: 8 },
    grid: { color: CHART_GRID },
    bounds: "ticks",
  };

  const compositionCanvas = document.getElementById("quality-composition-chart");
  const spikeCanvas = document.getElementById("spike-timeline-chart");
  const scatterCanvas = document.getElementById("latency-jitter-scatter-chart");

  if (!compositionCanvas && !spikeCanvas && !scatterCanvas) {
    return;
  }

  if (compositionCanvas) {
    qualityCompositionChart = new Chart(compositionCanvas, {
      type: "bar",
      data: {
        datasets: [
          {
            label: "Good",
            data: [],
            backgroundColor: QUALITY_PIE_COLORS[0],
            stack: "quality",
            barPercentage: 1,
            categoryPercentage: 1,
          },
          {
            label: "Fair",
            data: [],
            backgroundColor: QUALITY_PIE_COLORS[1],
            stack: "quality",
            barPercentage: 1,
            categoryPercentage: 1,
          },
          {
            label: "Poor",
            data: [],
            backgroundColor: QUALITY_PIE_COLORS[2],
            stack: "quality",
            barPercentage: 1,
            categoryPercentage: 1,
          },
          {
            label: "No data",
            data: [],
            backgroundColor: QUALITY_PIE_COLORS[3],
            stack: "quality",
            barPercentage: 1,
            categoryPercentage: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        scales: {
          x: {
            ...timeScale,
            stacked: true,
            time: {
              unit: "minute",
              displayFormats: { minute: "HH:mm" },
            },
            offset: false,
            grid: { color: CHART_GRID, offset: false },
          },
          y: {
            stacked: true,
            display: false,
            max: 1,
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: {
              color: "#aebed8",
              usePointStyle: true,
              boxWidth: 8,
              boxHeight: 8,
              padding: 12,
            },
          },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              title(items) {
                const point = items[0]?.raw;
                if (!point?.x) {
                  return "";
                }
                return new Date(point.x).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
              },
              label(context) {
                return context.dataset.label ?? "";
              },
            },
          },
        },
      },
    });
  }

  if (spikeCanvas) {
    spikeTimelineChart = new Chart(spikeCanvas, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Spikes",
            data: [],
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: (context) =>
              spikePointColor(context.raw?.severity ?? 1),
            pointBorderColor: "transparent",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        scales: {
          x: {
            ...timeScale,
            time: {
              unit: "minute",
              displayFormats: { minute: "HH:mm" },
            },
          },
          y: {
            beginAtZero: true,
            ticks: monoTicks,
            grid: { color: CHART_GRID },
            title: {
              display: true,
              text: "Latency (ms)",
              color: CHART_TICK,
              font: { size: 10 },
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              title(items) {
                const point = items[0]?.raw;
                if (!point?.ts) {
                  return "";
                }
                return new Date(point.ts).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
              },
              label(context) {
                const point = context.raw;
                if (!point) {
                  return "No data";
                }
                return [
                  `Latency: ${point.y.toFixed(1)} ms`,
                  `Threshold: ${point.threshold.toFixed(1)} ms`,
                ];
              },
            },
          },
        },
      },
    });
  }

  if (scatterCanvas) {
    latencyJitterScatterChart = new Chart(scatterCanvas, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Pings",
            data: [],
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: (context) =>
              scatterPointColor(context.raw?.rating ?? "none"),
            pointBorderColor: "transparent",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        scales: {
          x: {
            beginAtZero: true,
            ticks: monoTicks,
            grid: { color: CHART_GRID },
            title: {
              display: true,
              text: "Latency (ms)",
              color: CHART_TICK,
              font: { size: 10 },
            },
          },
          y: {
            beginAtZero: true,
            ticks: monoTicks,
            grid: { color: CHART_GRID },
            title: {
              display: true,
              text: "Jitter (ms)",
              color: CHART_TICK,
              font: { size: 10 },
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              title(items) {
                const point = items[0]?.raw;
                if (!point?.ts) {
                  return "";
                }
                return new Date(point.ts).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
              },
              label(context) {
                const point = context.raw;
                if (!point) {
                  return "No data";
                }
                return [
                  `Latency: ${point.x.toFixed(1)} ms`,
                  `Jitter: ${point.y.toFixed(1)} ms`,
                ];
              },
            },
          },
        },
      },
    });
  }
}

function updateQualityCompositionChart(blocks) {
  if (!qualityCompositionChart) {
    return;
  }

  const { good, fair, poor, empty } = buildQualityCompositionData(blocks?.buckets);
  qualityCompositionChart.data.datasets[0].data = good;
  qualityCompositionChart.data.datasets[1].data = fair;
  qualityCompositionChart.data.datasets[2].data = poor;
  qualityCompositionChart.data.datasets[3].data = empty;
  qualityCompositionChart.update("none");
}

function updateSpikeTimelineChart(samples) {
  if (!spikeTimelineChart) {
    return;
  }

  spikeTimelineChart.data.datasets[0].data = computeWindowSpikeEvents(samples);
  spikeTimelineChart.update("none");
}

function updateLatencyJitterScatterChart(samples) {
  if (!latencyJitterScatterChart) {
    return;
  }

  latencyJitterScatterChart.data.datasets[0].data = buildLatencyJitterScatterData(samples);
  latencyJitterScatterChart.update("none");
}

function updateAnalyticsCharts(payload) {
  const { samples, blocks } = payload ?? {};
  updateQualityCompositionChart(blocks);
  updateSpikeTimelineChart(samples);
  updateLatencyJitterScatterChart(samples);
}
