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
  [],
);

/* Neon glow on the primary latency line — matches dashboard accent styling. */
const lineGlowPlugin = {
  id: "lineGlow",
  beforeDatasetDraw(chart, args) {
    if (args.index !== 0) {
      return;
    }
    const ctx = chart.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(69, 200, 255, 0.45)";
    ctx.shadowBlur = 8;
  },
  afterDatasetDraw(chart, args) {
    if (args.index !== 0) {
      return;
    }
    chart.ctx.restore();
  },
};

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

const outageShadingPlugin = {
  id: "outageShading",
  beforeDatasetsDraw(chart) {
    const outages = chart.$outages;
    if (!outages?.length) {
      return;
    }
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    if (!chartArea || !x) {
      return;
    }
    ctx.save();
    for (const outage of outages) {
      const startMs = new Date(outage.start_ts).getTime();
      const endMs = outage.end_ts
        ? new Date(outage.end_ts).getTime()
        : chart.$latestTs
          ? new Date(chart.$latestTs).getTime()
          : Date.now();
      const left = x.getPixelForValue(startMs);
      const right = x.getPixelForValue(endMs);
      if (right < chartArea.left || left > chartArea.right) {
        continue;
      }
      const x0 = Math.max(chartArea.left, left);
      const x1 = Math.min(chartArea.right, right);
      ctx.fillStyle = outage.ongoing ? "rgba(255, 51, 85, 0.14)" : "rgba(255, 93, 108, 0.1)";
      ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
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
