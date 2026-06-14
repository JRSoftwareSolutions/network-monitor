/* ---------- charts ---------- */

function buildHistoryPieBootstrap(tooltipStyle) {
  const historyPieTooltip = {
    ...tooltipStyle,
    callbacks: {
      label(context) {
        const count = context.raw ?? 0;
        const total = context.chart.$pieTotal ?? 0;
        if (!total) {
          return "No data";
        }
        const pct = ((count / total) * 100).toFixed(1);
        return `${count} (${pct}%)`;
      },
    },
  };

  return {
    historyPieOptions: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "62%",
      plugins: {
        legend: { display: false },
        tooltip: historyPieTooltip,
      },
    },
    ratingPieColors: RATING_PIE_COLORS,
    qualityPieColors: QUALITY_PIE_COLORS,
  };
}

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
  if (typeof Chart === "undefined") {
    console.error("Chart.js did not load — charts disabled (CDN blocked or offline?)");
    return;
  }

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

  const latencyTimeScale = {
    type: "time",
    time: {
      unit: "minute",
      displayFormats: {
        minute: "HH:mm",
        second: "HH:mm:ss",
      },
    },
    ticks: {
      ...monoTicks,
      maxTicksLimit: 6,
      maxRotation: 0,
      autoSkip: true,
    },
    grid: { display: false },
    border: { display: false },
    bounds: "ticks",
  };

  latencyChart = new Chart(document.getElementById("latency-chart"), {
    type: "line",
    plugins: [latencyBandsPlugin, failureStripsPlugin, outageShadingPlugin, referenceLinesPlugin, lineGlowPlugin],
    data: {
      datasets: [
        {
          label: "Latency (ms)",
          data: [],
          borderColor: CHART_COLORS.latency,
          backgroundColor: areaGradient(CHART_COLORS.latency, "28"),
          fill: true,
          borderWidth: 1.25,
          tension: 0,
          pointRadius: 0,
          spanGaps: false,
          order: 1,
        },
        {
          label: "Jitter band (±)",
          data: [],
          borderColor: "rgba(179, 136, 255, 0)",
          backgroundColor: "rgba(179, 136, 255, 0.12)",
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
        {
          label: "60s rolling median",
          data: [],
          borderColor: "rgba(61, 255, 162, 0.72)",
          backgroundColor: "rgba(61, 255, 162, 0)",
          fill: false,
          borderWidth: 1.5,
          borderDash: [5, 4],
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      layout: {
        padding: { top: 6, right: 4, bottom: 2, left: 0 },
      },
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: latencyTimeScale,
        y: {
          beginAtZero: true,
          suggestedMax: 40,
          grace: 0,
          ticks: {
            ...monoTicks,
            maxTicksLimit: 4,
            padding: 6,
            callback: (value) => `${value}`,
          },
          grid: { display: false },
          border: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
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
          suggestedMax: 12,
          grace: 0,
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

  try {
    latencyBlocksChart = new Chart(document.getElementById("latency-blocks-chart"), {
    type: "candlestick",
    plugins: [qualityCandleColorsPlugin, minuteHighlightPlugin],
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
  } catch (error) {
    console.error("Latency blocks chart unavailable", error);
  }

  try {
    distributionChart = new Chart(document.getElementById("distribution-chart"), {
      type: "bar",
      data: {
        labels: ["Great", "Good", "Okay", "Bad", "Failed"],
        datasets: [
          {
            label: "Ping count",
            data: [0, 0, 0, 0, 0],
            backgroundColor: [
              `${LEVEL_COLORS.great}cc`,
              `${LEVEL_COLORS.good}cc`,
              `${LEVEL_COLORS.okay}cc`,
              `${LEVEL_COLORS.bad}cc`,
              `${LEVEL_COLORS.offline}cc`,
            ],
            borderRadius: 4,
            borderSkipped: false,
            barPercentage: 0.72,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              ...monoTicks,
              precision: 0,
            },
            grid: { color: CHART_GRID },
          },
          y: {
            ticks: monoTicks,
            grid: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label(context) {
                const count = context.raw ?? 0;
                const total = context.chart.$distributionTotal ?? 0;
                const pct = total ? ((count / total) * 100).toFixed(1) : "0.0";
                return `${count} pings (${pct}%)`;
              },
            },
          },
        },
      },
    });
  } catch (error) {
    console.error("Distribution chart unavailable", error);
  }

  initChartResizeObserver();
  initAnalyticsCharts?.();
  historyPieBootstrap = buildHistoryPieBootstrap(tooltipStyle);
  ensureHistoryPieCharts();
  requestAnimationFrame(() => {
    requestAnimationFrame(resizeCharts);
  });
}

let chartResizeObserver;
let chartResizeFrame;
let historyPieBootstrap;

function scheduleChartResize() {
  cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = requestAnimationFrame(() => {
    chartResizeFrame = requestAnimationFrame(resizeCharts);
  });
}

function ensureHistoryPieCharts() {
  if (typeof Chart === "undefined" || !historyPieBootstrap) {
    return;
  }

  const panel = document.querySelector('[data-panel="history-breakdown"]');
  if (!panel || panel.classList.contains("is-panel-hidden")) {
    return;
  }

  if (historyLatencyPie) {
    return;
  }

  const { historyPieOptions, ratingPieColors, qualityPieColors } = historyPieBootstrap;

  try {
    historyLatencyPie = new Chart(document.getElementById("history-latency-pie"), {
      type: "doughnut",
      data: {
        labels: ["Great", "Good", "Okay", "Bad", "Failed"],
        datasets: [{ data: [1], backgroundColor: ["rgba(143, 163, 194, 0.2)"], borderWidth: 0 }],
      },
      options: historyPieOptions,
    });

    historyJitterPie = new Chart(document.getElementById("history-jitter-pie"), {
      type: "doughnut",
      data: {
        labels: ["Stable", "Moderate", "Uneven", "Volatile"],
        datasets: [{ data: [1], backgroundColor: ratingPieColors.slice(0, 4), borderWidth: 0 }],
      },
      options: historyPieOptions,
    });

    historyLossPie = new Chart(document.getElementById("history-loss-pie"), {
      type: "doughnut",
      data: {
        labels: ["Clean", "Minor", "Moderate", "Heavy"],
        datasets: [{ data: [1], backgroundColor: ratingPieColors.slice(0, 4), borderWidth: 0 }],
      },
      options: historyPieOptions,
    });

    historyQualityPie = new Chart(document.getElementById("history-quality-pie"), {
      type: "doughnut",
      data: {
        labels: ["Good", "Fair", "Poor", "No data"],
        datasets: [{ data: [1], backgroundColor: qualityPieColors, borderWidth: 0 }],
      },
      options: historyPieOptions,
    });

    initChartResizeObserver();

    if (lastMetricsPayload && needsHistoryVisualizations?.()) {
      applyHistoryVisualizations(lastMetricsPayload);
    }
  } catch (error) {
    console.error("History breakdown charts unavailable", error);
  }
}

function initChartResizeObserver() {
  chartResizeObserver?.disconnect();
  chartResizeObserver = new ResizeObserver(() => {
    scheduleChartResize();
  });

  for (const id of [
    "latency-chart",
    "jitter-chart",
    "loss-chart",
    "latency-blocks-chart",
    "distribution-chart",
    "history-latency-pie",
    "history-jitter-pie",
    "history-loss-pie",
    "history-quality-pie",
  ]) {
    const wrap = document.getElementById(id)?.closest(".chart-wrap");
    if (wrap) {
      chartResizeObserver.observe(wrap);
    }
  }

  for (const figure of document.querySelectorAll(".history-pie")) {
    chartResizeObserver.observe(figure);
  }

  const breakdownPanel = document.querySelector('[data-panel="history-breakdown"]');
  if (breakdownPanel) {
    chartResizeObserver.observe(breakdownPanel);
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
  if (!chart) {
    return;
  }
  chart.options.scales.x.min = range.min;
  chart.options.scales.x.max = range.max;
}

function updateBlocksChart(blocksPayload, windowMinutes, latestTs) {
  if (!latencyBlocksChart) {
    return;
  }
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

function sortSamplesByTime(samples) {
  if (!samples?.length || samples.length < 2) {
    return samples ?? [];
  }
  return [...samples].sort((a, b) => sampleTimestamp(a) - sampleTimestamp(b));
}

/* Collapse duplicate timestamps so Chart.js does not draw vertical segments. */
function dedupeSamplesByTime(samples) {
  if (!samples?.length) {
    return [];
  }
  const sorted = sortSamplesByTime(samples);
  const result = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const sample = sorted[i];
    if (sampleTimestamp(sample) === sampleTimestamp(result[result.length - 1])) {
      result[result.length - 1] = sample;
    } else {
      result.push(sample);
    }
  }
  return result;
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

function updateCharts(samples, windowMinutes, latestTs, outages = [], stats = null, baselineMs = null) {
  if (!latencyChart || !jitterChart) {
    return;
  }
  const range = chartTimeRange(windowMinutes, latestTs);
  applyChartTimeRange(latencyChart, range);
  applyChartTimeRange(jitterChart, range);

  const orderedSamples = dedupeSamplesByTime(samples);
  const latencyData = [];
  const bandUpper = [];
  const bandLower = [];
  const jitterData = [];
  const failures = [];

  for (const sample of orderedSamples) {
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

  const rollingMedian = computeRollingMedianSeries(orderedSamples);

  latencyChart.data.datasets[0].data = latencyData;
  latencyChart.data.datasets[1].data = bandUpper;
  latencyChart.data.datasets[2].data = bandLower;
  latencyChart.data.datasets[3].data = rollingMedian;
  latencyChart.$failures = failures;
  latencyChart.$failureWidthMs = medianSampleSpacingMs(orderedSamples);
  latencyChart.$outages = outages ?? [];
  latencyChart.$latestTs = latestTs;
  latencyChart.$referenceLines = latencyReferenceLines(stats, baselineMs);
  const latencyYMax = computeLatencyYMax(latencyData, stats, baselineMs, bandUpper);
  latencyChart.options.scales.y.max = latencyYMax;
  latencyChart.options.scales.y.suggestedMax = latencyYMax;
  latencyChart.update("none");

  jitterChart.data.datasets[0].data = jitterData;
  const jitterYMax = computeJitterYMax(jitterData);
  jitterChart.options.scales.y.max = jitterYMax;
  jitterChart.options.scales.y.suggestedMax = jitterYMax;
  jitterChart.update("none");
}

function updateLossChart(blocksPayload, windowMinutes, latestTs) {
  if (!lossChart) {
    return;
  }
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

