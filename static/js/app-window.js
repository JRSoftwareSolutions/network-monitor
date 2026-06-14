/* ---------- window panel ---------- */

function setStatRating(el, metric, value) {
  if (!el) {
    return;
  }
  if (value === null || value === undefined) {
    el.dataset.rating = "none";
    return;
  }
  el.dataset.rating = rateMetric(metric, value);
}

function updateSummaryCards(stats) {
  avgLatencyEl.textContent = formatMs(stats.latency_avg_ms);
  minLatencyEl.textContent = formatMs(stats.latency_min_ms);
  maxLatencyEl.textContent = formatMs(stats.latency_max_ms);
  p95LatencyEl.textContent = formatMs(stats.latency_p95_ms);
  avgJitterEl.textContent = formatMs(stats.jitter_avg_ms);
  packetLossEl.textContent = formatPercent(stats.packet_loss_pct);
  uptimePctEl.textContent = formatPercent(stats.uptime_pct);
  sampleCountEl.textContent = String(stats.sample_count);

  setStatRating(avgLatencyEl, "ping", stats.latency_avg_ms);
  setStatRating(minLatencyEl, "ping", stats.latency_min_ms);
  setStatRating(maxLatencyEl, "ping", stats.latency_max_ms);
  setStatRating(p95LatencyEl, "ping", stats.latency_p95_ms);
  setStatRating(avgJitterEl, "jitter", stats.jitter_avg_ms);
  setStatRating(packetLossEl, "loss", stats.packet_loss_pct);
  if (stats.uptime_pct != null) {
    uptimePctEl.dataset.rating = rateMetric("loss", 100 - stats.uptime_pct);
  } else {
    uptimePctEl.dataset.rating = "none";
  }
}

function minuteOverlapsOutage(bucketStart, bucketEnd, outages) {
  const startMs = new Date(bucketStart).getTime();
  const endMs = new Date(bucketEnd).getTime();
  return (outages ?? []).some((outage) => {
    const outageStart = new Date(outage.start_ts).getTime();
    const outageEnd = outage.end_ts ? new Date(outage.end_ts).getTime() : Date.now();
    return outageStart < endMs && outageEnd > startMs;
  });
}

function formatBucketTooltip(bucket) {
  const start = formatTime(bucket.ts_start);
  const end = formatTime(bucket.ts_end);
  if (!bucket.sample_count) {
    return `${start} — ${end}\nNo samples`;
  }
  const quality = badnessToQuality(bucketBadness(bucket));
  const lines = [
    `${start} — ${end}`,
    `Quality: ${quality}`,
    `Avg: ${bucket.avg_ms != null ? `${bucket.avg_ms.toFixed(1)} ms` : "—"}`,
    `Jitter: ${bucket.jitter_avg_ms != null ? `${bucket.jitter_avg_ms.toFixed(1)} ms` : "—"}`,
    `Loss: ${(bucket.loss_pct ?? 0).toFixed(1)}%`,
  ];
  return lines.join("\n");
}

function updateQualityTimeline(blocksPayload, outages, windowMinutes, latestTs) {
  if (!qualityTimeline) {
    return;
  }

  const buckets = blocksPayload?.buckets ?? [];
  if (!buckets.length) {
    qualityTimeline.innerHTML = '<div class="quality-timeline-empty">Waiting for data…</div>';
    return;
  }

  qualityTimeline.innerHTML = buckets
    .map((bucket) => {
      const hasSamples = bucket.sample_count > 0;
      const isOffline = hasSamples && (bucket.loss_pct ?? 0) >= 100;
      const quality = hasSamples ? badnessToQuality(bucketBadness(bucket)) : "empty";
      const outage = minuteOverlapsOutage(bucket.ts_start, bucket.ts_end, outages);
      const classes = [
        "quality-timeline-cell",
        `quality-timeline-cell--${quality}`,
        !hasSamples ? "quality-timeline-cell--empty" : "",
        isOffline ? "quality-timeline-cell--offline" : "",
        outage ? "quality-timeline-cell--outage" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const tsMs = new Date(bucket.ts_start).getTime();

      return `<div class="${classes}" data-ts-ms="${tsMs}" title="${formatBucketTooltip(bucket).replace(/"/g, "&quot;")}"></div>`;
    })
    .join("");

  qualityTimeline.dataset.windowMinutes = String(windowMinutes);
  qualityTimeline.dataset.latestTs = latestTs ?? "";

  const activeTs = pinnedMinuteTsMs ?? highlightedMinuteTsMs;
  if (activeTs != null) {
    highlightedMinuteTsMs = null;
    setHighlightedMinute(activeTs);
  }
}

function updateQualityBreakdown(blocksPayload) {
  const buckets = (blocksPayload?.buckets ?? []).filter((bucket) => bucket.sample_count > 0);
  const counts = { good: 0, fair: 0, poor: 0 };
  let emptyCount = 0;

  for (const bucket of blocksPayload?.buckets ?? []) {
    if (!bucket.sample_count) {
      emptyCount += 1;
      continue;
    }
    const quality = badnessToQuality(bucketBadness(bucket));
    if (quality === "good") {
      counts.good += 1;
    } else if (quality === "fair") {
      counts.fair += 1;
    } else {
      counts.poor += 1;
    }
  }

  const total = buckets.length + emptyCount || 1;
  const pct = (count) => `${((count / total) * 100).toFixed(0)}%`;

  if (breakdownGood) {
    breakdownGood.style.flexGrow = String(counts.good);
    breakdownGood.style.flexBasis = counts.good ? `${pct(counts.good)}` : "0";
  }
  if (breakdownFair) {
    breakdownFair.style.flexGrow = String(counts.fair);
    breakdownFair.style.flexBasis = counts.fair ? `${pct(counts.fair)}` : "0";
  }
  if (breakdownPoor) {
    breakdownPoor.style.flexGrow = String(counts.poor);
    breakdownPoor.style.flexBasis = counts.poor ? `${pct(counts.poor)}` : "0";
  }
  if (breakdownEmpty) {
    breakdownEmpty.style.flexGrow = String(emptyCount);
    breakdownEmpty.style.flexBasis = emptyCount ? `${pct(emptyCount)}` : "0";
  }

  if (qualityBreakdownLegend) {
    const parts = [];
    if (counts.good) {
      parts.push(`good ${pct(counts.good)}`);
    }
    if (counts.fair) {
      parts.push(`fair ${pct(counts.fair)}`);
    }
    if (counts.poor) {
      parts.push(`poor ${pct(counts.poor)}`);
    }
    if (emptyCount) {
      parts.push(`no data ${pct(emptyCount)}`);
    }
    qualityBreakdownLegend.textContent = parts.length ? parts.join(" · ") : "No minute buckets yet";
  }
}

function updateDistributionChart(samples) {
  if (!distributionChart) {
    return;
  }

  const counts = countLatencyTiers(samples);
  const data = DISTRIBUTION_LABELS.map((label) => counts[label] ?? 0);
  const total = data.reduce((sum, value) => sum + value, 0);
  distributionChart.$distributionTotal = total;
  distributionChart.data.datasets[0].data = data;
  distributionChart.update("none");

  if (distributionInsight) {
    if (!total) {
      distributionInsight.textContent = "How pings spread across quality tiers in this window";
      return;
    }
    let dominant = "great";
    let dominantCount = 0;
    for (const label of DISTRIBUTION_LABELS) {
      if (counts[label] > dominantCount) {
        dominant = label;
        dominantCount = counts[label];
      }
    }
    const dominantPct = ((dominantCount / total) * 100).toFixed(0);
    const labelText = dominant === "failed" ? "failed pings" : `${dominant} latency`;
    distributionInsight.textContent = `Most pings were ${labelText} (${dominantPct}%) · ${total} total`;
  }
}

function renderMinuteQualityRow(bucket, badness) {
  const quality = badnessToQuality(badness);
  const latencyRating = bucket.avg_ms != null ? rateMetric("ping", bucket.avg_ms) : "none";
  const jitterRating = bucket.jitter_avg_ms != null ? rateMetric("jitter", bucket.jitter_avg_ms) : "none";
  const lossRating = rateMetric("loss", bucket.loss_pct ?? 0);
  return `
    <tr>
      <td class="tabular">${formatTime(bucket.ts_start)}</td>
      <td class="tabular cell-rating" data-rating="${latencyRating}">${bucket.avg_ms != null ? formatMs(bucket.avg_ms) : "—"}</td>
      <td class="tabular cell-rating" data-rating="${jitterRating}">${bucket.jitter_avg_ms != null ? formatMs(bucket.jitter_avg_ms) : "—"}</td>
      <td class="tabular cell-rating" data-rating="${lossRating}">${formatPercent(bucket.loss_pct ?? 0)}</td>
      <td><span class="badge badge--quality badge--quality-${quality}">${quality}</span></td>
    </tr>
  `;
}

function renderMinuteLogRow(bucket, badness) {
  const quality = badnessToQuality(badness);
  const latencyRating = bucket.avg_ms != null ? rateMetric("ping", bucket.avg_ms) : "none";
  const lowRating = bucket.low_ms != null ? rateMetric("ping", bucket.low_ms) : "none";
  const highRating = bucket.high_ms != null ? rateMetric("ping", bucket.high_ms) : "none";
  const jitterRating = bucket.jitter_avg_ms != null ? rateMetric("jitter", bucket.jitter_avg_ms) : "none";
  const lossRating = rateMetric("loss", bucket.loss_pct ?? 0);
  return `
    <tr>
      <td class="tabular">${formatTime(bucket.ts_start)}</td>
      <td class="tabular cell-rating" data-rating="${latencyRating}">${bucket.avg_ms != null ? formatMs(bucket.avg_ms) : "—"}</td>
      <td class="tabular cell-rating" data-rating="${lowRating}">${bucket.low_ms != null ? formatMs(bucket.low_ms) : "—"}</td>
      <td class="tabular cell-rating" data-rating="${highRating}">${bucket.high_ms != null ? formatMs(bucket.high_ms) : "—"}</td>
      <td class="tabular cell-rating" data-rating="${jitterRating}">${bucket.jitter_avg_ms != null ? formatMs(bucket.jitter_avg_ms) : "—"}</td>
      <td class="tabular cell-rating" data-rating="${lossRating}">${formatPercent(bucket.loss_pct ?? 0)}</td>
      <td><span class="badge badge--quality badge--quality-${quality}">${quality}</span></td>
    </tr>
  `;
}

function getSampledBuckets(blocksPayload) {
  return (blocksPayload?.buckets ?? []).filter((bucket) => bucket.sample_count > 0);
}

function updateWindowInsights({ stats, health, outages, blocks }) {
  if (!insightPeakLatency) {
    return;
  }

  const sampledBuckets = getSampledBuckets(blocks);

  if (stats?.latency_max_ms != null) {
    insightPeakLatency.textContent = formatMs(stats.latency_max_ms);
    insightPeakLatency.dataset.rating = rateMetric("ping", stats.latency_max_ms);
  } else {
    insightPeakLatency.textContent = "—";
    insightPeakLatency.dataset.rating = "none";
  }

  const peakBucket = sampledBuckets.reduce(
    (best, bucket) =>
      bucket.high_ms != null && (best == null || bucket.high_ms > best.high_ms) ? bucket : best,
    null,
  );
  if (peakBucket) {
    insightPeakMinute.textContent = `${formatTime(peakBucket.ts_start)} · ${formatMs(peakBucket.high_ms)}`;
    insightPeakMinute.dataset.rating = rateMetric("ping", peakBucket.high_ms);
  } else {
    insightPeakMinute.textContent = "—";
    insightPeakMinute.dataset.rating = "none";
  }

  const bestBucket = sampledBuckets.reduce(
    (best, bucket) =>
      bucket.avg_ms != null && (best == null || bucket.avg_ms < best.avg_ms) ? bucket : best,
    null,
  );
  if (bestBucket) {
    insightBestMinute.textContent = `${formatTime(bestBucket.ts_start)} · ${formatMs(bestBucket.avg_ms)}`;
    insightBestMinute.dataset.rating = rateMetric("ping", bestBucket.avg_ms);
  } else {
    insightBestMinute.textContent = "—";
    insightBestMinute.dataset.rating = "none";
  }

  const totalDowntime = (outages ?? []).reduce((sum, outage) => sum + (outage.duration_seconds ?? 0), 0);
  if (outages?.length) {
    insightTotalDowntime.textContent = formatDuration(totalDowntime);
    insightTotalDowntime.dataset.rating = totalDowntime >= 60 ? "bad" : totalDowntime >= 15 ? "okay" : "good";
  } else {
    insightTotalDowntime.textContent = "0s";
    insightTotalDowntime.dataset.rating = "great";
  }

  insightOutageCount.textContent = String(outages?.length ?? 0);
  insightOutageCount.dataset.rating =
    (outages?.length ?? 0) >= 3 ? "bad" : (outages?.length ?? 0) >= 1 ? "okay" : "great";

  const reasons = health?.reasons?.length ? health.reasons.join(" · ") : "No issues";
  insightHealthReasons.textContent = reasons;
  insightHealthReasons.dataset.rating = HEALTH_TO_RATING[health?.level ?? "no_data"] ?? "none";
}

function updateWorstMinutesTable(blocksPayload, limit = HISTORY_MINUTE_TABLE_LIMIT) {
  if (!worstMinutesTable) {
    return;
  }

  const buckets = getSampledBuckets(blocksPayload)
    .map((bucket) => ({ bucket, badness: bucketBadness(bucket) }))
    .sort((a, b) => b.badness - a.badness)
    .slice(0, limit);

  if (!buckets.length) {
    worstMinutesTable.innerHTML = '<tr><td colspan="5" class="empty">No data in this window</td></tr>';
    return;
  }

  worstMinutesTable.innerHTML = buckets
    .map(({ bucket, badness }) => renderMinuteQualityRow(bucket, badness))
    .join("");
}

function updateBestMinutesTable(blocksPayload, limit = HISTORY_MINUTE_TABLE_LIMIT) {
  if (!bestMinutesTable) {
    return;
  }

  const buckets = getSampledBuckets(blocksPayload)
    .map((bucket) => ({ bucket, badness: bucketBadness(bucket) }))
    .sort((a, b) => a.badness - b.badness)
    .slice(0, limit);

  if (!buckets.length) {
    bestMinutesTable.innerHTML = '<tr><td colspan="5" class="empty">No data in this window</td></tr>';
    return;
  }

  bestMinutesTable.innerHTML = buckets
    .map(({ bucket, badness }) => renderMinuteQualityRow(bucket, badness))
    .join("");
}

function updateMinuteLogTable(blocksPayload) {
  if (!minuteLogTable) {
    return;
  }

  const buckets = getSampledBuckets(blocksPayload)
    .map((bucket) => ({ bucket, badness: bucketBadness(bucket) }))
    .sort((a, b) => new Date(a.bucket.ts_start) - new Date(b.bucket.ts_start));

  if (!buckets.length) {
    minuteLogTable.innerHTML = '<tr><td colspan="7" class="empty">No data in this window</td></tr>';
    return;
  }

  minuteLogTable.innerHTML = buckets
    .map(({ bucket, badness }) => renderMinuteLogRow(bucket, badness))
    .join("");
}

function countLatencyTiers(samples) {
  const counts = { great: 0, good: 0, okay: 0, bad: 0, failed: 0 };
  for (const sample of samples ?? []) {
    if (!sample.success) {
      counts.failed += 1;
      continue;
    }
    if (sample.latency_ms == null) {
      continue;
    }
    counts[rateMetric("ping", sample.latency_ms)] += 1;
  }
  return counts;
}

function countJitterTiers(samples) {
  const counts = { great: 0, good: 0, okay: 0, bad: 0 };
  for (const sample of samples ?? []) {
    if (!sample.success || sample.jitter_ms == null) {
      continue;
    }
    counts[rateMetric("jitter", sample.jitter_ms)] += 1;
  }
  return counts;
}

function countLossTiers(blocksPayload) {
  const counts = { great: 0, good: 0, okay: 0, bad: 0 };
  for (const bucket of blocksPayload?.buckets ?? []) {
    if (!bucket.sample_count) {
      continue;
    }
    counts[rateMetric("loss", bucket.loss_pct ?? 0)] += 1;
  }
  return counts;
}

function countQualityTiers(blocksPayload) {
  const counts = { good: 0, fair: 0, poor: 0, empty: 0 };
  for (const bucket of blocksPayload?.buckets ?? []) {
    if (!bucket.sample_count) {
      counts.empty += 1;
      continue;
    }
    counts[badnessToQuality(bucketBadness(bucket))] += 1;
  }
  return counts;
}

function dominantTierCaption(counts, labels, keys) {
  let dominant = keys[0];
  let max = 0;
  let total = 0;
  for (const key of keys) {
    const count = counts[key] ?? 0;
    total += count;
    if (count > max) {
      max = count;
      dominant = key;
    }
  }
  if (!total) {
    return "No data yet";
  }
  const labelIndex = keys.indexOf(dominant);
  const label = labels[labelIndex] ?? dominant;
  const pct = ((max / total) * 100).toFixed(0);
  return `${pct}% ${label.toLowerCase()}`;
}

function setHistoryPieChart(chart, counts, keys, colors) {
  if (!chart) {
    return 0;
  }
  const data = keys.map((key) => counts[key] ?? 0);
  const total = data.reduce((sum, value) => sum + value, 0);
  chart.$pieTotal = total;
  chart.data.datasets[0].data = total ? data : [1];
  chart.data.datasets[0].backgroundColor = total ? colors.slice(0, data.length) : ["rgba(143, 163, 194, 0.2)"];
  chart.update("none");
  return total;
}

function updateHistoryPieCharts(samples, blocks) {
  const latencyCounts = countLatencyTiers(samples);
  setHistoryPieChart(historyLatencyPie, latencyCounts, DISTRIBUTION_LABELS, RATING_PIE_COLORS);
  if (historyPieCaptions.latency) {
    historyPieCaptions.latency.textContent = dominantTierCaption(
      latencyCounts,
      ["Great", "Good", "Okay", "Bad", "Failed"],
      DISTRIBUTION_LABELS,
    );
  }

  const jitterCounts = countJitterTiers(samples);
  setHistoryPieChart(historyJitterPie, jitterCounts, RATING_ORDER, RATING_PIE_COLORS);
  if (historyPieCaptions.jitter) {
    historyPieCaptions.jitter.textContent = dominantTierCaption(
      jitterCounts,
      ["Stable", "Moderate", "Uneven", "Volatile"],
      RATING_ORDER,
    );
  }

  const lossCounts = countLossTiers(blocks);
  setHistoryPieChart(historyLossPie, lossCounts, RATING_ORDER, RATING_PIE_COLORS);
  if (historyPieCaptions.loss) {
    historyPieCaptions.loss.textContent = dominantTierCaption(
      lossCounts,
      ["Clean", "Minor", "Moderate", "Heavy"],
      RATING_ORDER,
    );
  }

  const qualityCounts = countQualityTiers(blocks);
  setHistoryPieChart(historyQualityPie, qualityCounts, ["good", "fair", "poor", "empty"], QUALITY_PIE_COLORS);
  if (historyPieCaptions.quality) {
    historyPieCaptions.quality.textContent = dominantTierCaption(
      qualityCounts,
      ["Good", "Fair", "Poor", "No data"],
      ["good", "fair", "poor", "empty"],
    );
  }
}

function applyHistoryVisualizations(payload) {
  const {
    samples,
    stats,
    blocks,
    health,
    outages,
    window_minutes: windowMinutes,
    latest_ts: latestTs,
  } = payload;
  const windowMins = windowMinutes ?? getWindowMinutes();

  applyBlocksPanelCopy("history", windowMins);

  const latencyPanelTitle = document.querySelector('[data-panel="latency"] h2');
  if (latencyPanelTitle) {
    latencyPanelTitle.textContent = "Latency trend";
  }

  updateWindowSummary(health, stats, outages, windowMins);
  updateQualityTimeline(blocks, outages, windowMins, latestTs);
  updateQualityBreakdown(blocks);
  updateStatSparklines(blocks);
  updateHistoryPieCharts(samples, blocks);
  updateDistributionChart(samples);
  updateWindowInsights({ stats, health, outages, blocks });
  updateWorstMinutesTable(blocks);
  updateBestMinutesTable(blocks);
  updateMinuteLogTable(blocks);
  updateAnalyticsCharts?.(payload);
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

function updateRecentTable(samples, { limit = 20 } = {}) {
  const recent = (samples ?? []).slice(-limit).reverse();
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

/* ---------- stat sparklines ---------- */

const STAT_SPARKLINES = {
  "avg-latency": { field: "avg_ms", color: CHART_COLORS.latency },
  "avg-jitter": { field: "jitter_avg_ms", color: CHART_COLORS.jitter },
  "packet-loss": { field: "loss_pct", color: CHART_COLORS.loss, ceiling: 15 },
};

function drawStatSparkline(canvas, values, color, ceiling = null) {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const points = values.filter((value) => value != null);
  if (points.length < 2) {
    return;
  }

  const maxY = ceiling ?? Math.max(...points, 1);
  const padY = 1;
  const usableH = height - padY * 2;
  const hex = color.startsWith("#") ? color.slice(1) : null;
  const fillColor = hex
    ? `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, 0.14)`
    : "rgba(69, 200, 255, 0.14)";

  const plotY = (value, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - padY - (value / maxY) * usableH;
    return { x, y };
  };

  ctx.beginPath();
  points.forEach((value, index) => {
    const { x, y } = plotY(value, index);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.beginPath();
  points.forEach((value, index) => {
    const { x, y } = plotY(value, index);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function updateStatSparklines(blocksPayload) {
  const buckets = (blocksPayload?.buckets ?? []).filter((bucket) => bucket.sample_count > 0);
  for (const [statId, config] of Object.entries(STAT_SPARKLINES)) {
    const canvas = document.getElementById(`sparkline-${statId}`);
    const values = buckets.map((bucket) => bucket[config.field] ?? null);
    drawStatSparkline(canvas, values, config.color, config.ceiling);
  }
}

/* ---------- quality timeline ↔ candlestick cross-highlight ---------- */

let highlightedMinuteTsMs = null;
let pinnedMinuteTsMs = null;
let blocksCrossHighlightReady = false;

function setHighlightedMinute(tsMs, { pin = false } = {}) {
  if (pin) {
    pinnedMinuteTsMs = pinnedMinuteTsMs === tsMs ? null : tsMs;
    tsMs = pinnedMinuteTsMs;
  } else if (pinnedMinuteTsMs != null) {
    return;
  }

  if (highlightedMinuteTsMs === tsMs) {
    return;
  }
  highlightedMinuteTsMs = tsMs;

  if (qualityTimeline) {
    for (const cell of qualityTimeline.querySelectorAll(".quality-timeline-cell")) {
      const cellTs = Number(cell.dataset.tsMs);
      cell.classList.toggle("quality-timeline-cell--highlighted", tsMs != null && cellTs === tsMs);
    }
  }

  if (latencyBlocksChart) {
    latencyBlocksChart.$highlightTsMs = tsMs;
    if (tsMs != null) {
      const index = latencyBlocksChart.data.datasets[0].data.findIndex((point) => point.x === tsMs);
      if (index >= 0) {
        latencyBlocksChart.setActiveElements([{ datasetIndex: 0, index }]);
      } else {
        latencyBlocksChart.setActiveElements([]);
      }
    } else {
      latencyBlocksChart.setActiveElements([]);
    }
    latencyBlocksChart.update("none");
  }
}

function initBlocksCrossHighlight() {
  if (blocksCrossHighlightReady || !qualityTimeline) {
    return;
  }
  blocksCrossHighlightReady = true;

  qualityTimeline.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(".quality-timeline-cell");
    if (!cell || pinnedMinuteTsMs != null) {
      return;
    }
    setHighlightedMinute(Number(cell.dataset.tsMs));
  });

  qualityTimeline.addEventListener("mouseleave", () => {
    if (pinnedMinuteTsMs == null) {
      setHighlightedMinute(null);
    }
  });

  qualityTimeline.addEventListener("click", (event) => {
    const cell = event.target.closest(".quality-timeline-cell");
    if (!cell) {
      return;
    }
    setHighlightedMinute(Number(cell.dataset.tsMs), { pin: true });
  });

  const blocksCanvas = document.getElementById("latency-blocks-chart");
  if (blocksCanvas && latencyBlocksChart) {
    blocksCanvas.addEventListener("mousemove", (event) => {
      if (pinnedMinuteTsMs != null) {
        return;
      }
      const hits = latencyBlocksChart.getElementsAtEventForMode(event, "index", { intersect: false });
      if (hits.length) {
        const point = latencyBlocksChart.data.datasets[0].data[hits[0].index];
        setHighlightedMinute(point?.x ?? null);
      } else {
        setHighlightedMinute(null);
      }
    });
    blocksCanvas.addEventListener("mouseleave", () => {
      if (pinnedMinuteTsMs == null) {
        setHighlightedMinute(null);
      }
    });
    blocksCanvas.addEventListener("click", (event) => {
      const hits = latencyBlocksChart.getElementsAtEventForMode(event, "index", { intersect: false });
      if (!hits.length) {
        setHighlightedMinute(null, { pin: true });
        return;
      }
      const point = latencyBlocksChart.data.datasets[0].data[hits[0].index];
      setHighlightedMinute(point?.x ?? null, { pin: true });
    });
  }
}

/* ---------- window metrics export ---------- */

function downloadBlob(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportWindowMetricsAsJson() {
  if (!lastMetricsPayload) {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadBlob(
    `network-monitor-${stamp}.json`,
    "application/json",
    JSON.stringify(lastMetricsPayload, null, 2),
  );
}

function exportWindowMetricsAsCsv() {
  if (!lastMetricsPayload) {
    return;
  }
  const buckets = lastMetricsPayload.blocks?.buckets ?? [];
  const header = ["ts_start", "ts_end", "avg_ms", "low_ms", "high_ms", "jitter_avg_ms", "loss_pct", "sample_count"];
  const rows = buckets.map((bucket) =>
    header.map((key) => {
      const value = bucket[key];
      return value == null ? "" : String(value);
    }).join(","),
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadBlob(`network-monitor-minutes-${stamp}.csv`, "text/csv", [header.join(","), ...rows].join("\n"));
}

function initMetricsExport() {
  const exportBtn = document.getElementById("export-metrics-btn");
  if (!exportBtn) {
    return;
  }
  exportBtn.addEventListener("click", (event) => {
    if (event.shiftKey) {
      exportWindowMetricsAsCsv();
    } else {
      exportWindowMetricsAsJson();
    }
  });
}

/* ---------- connection alerts ---------- */

const VERDICT_SEVERITY = {
  no_data: -1,
  great: 0,
  good: 1,
  okay: 2,
  bad: 3,
  offline: 4,
};

let lastAlertVerdictLevel = null;
let lastAlertOngoingOutages = 0;
let alertToastTimer;

function showAlertToast(message, level = "bad") {
  const toast = document.getElementById("alert-toast");
  const text = document.getElementById("alert-toast-text");
  if (!toast || !text) {
    return;
  }
  text.textContent = message;
  toast.dataset.level = level;
  toast.hidden = false;
  clearTimeout(alertToastTimer);
  alertToastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 8000);
}

function pushBrowserAlert(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  try {
    new Notification(title, { body, icon: faviconLink?.href });
  } catch {
    // Notification API unavailable in this context.
  }
}

function checkConnectionAlerts(now, outages) {
  const level = now?.display_verdict?.level ?? "no_data";
  const label = now?.display_verdict?.label ?? "Connection changed";
  const ongoing = (outages ?? []).filter((outage) => outage.ongoing).length;
  const prevLevel = lastAlertVerdictLevel;
  const prevOngoing = lastAlertOngoingOutages;

  if (
    prevLevel != null &&
    prevLevel !== "no_data" &&
    level !== "no_data" &&
    (VERDICT_SEVERITY[level] ?? -1) > (VERDICT_SEVERITY[prevLevel] ?? -1)
  ) {
    const message = `Verdict degraded to ${label}`;
    showAlertToast(message, level);
    pushBrowserAlert("Connection degraded", message);
  }

  if (ongoing > prevOngoing) {
    const message = ongoing === 1 ? "Outage started — pings failing" : `${ongoing} ongoing outages`;
    showAlertToast(message, "offline");
    pushBrowserAlert("Network outage", message);
  }

  if (level !== "no_data") {
    lastAlertVerdictLevel = level;
  }
  lastAlertOngoingOutages = ongoing;
}

function initConnectionAlerts() {
  const toast = document.getElementById("alert-toast");
  const closeBtn = document.getElementById("alert-toast-close");
  closeBtn?.addEventListener("click", () => {
    if (toast) {
      toast.hidden = true;
    }
    clearTimeout(alertToastTimer);
  });

  if ("Notification" in window && Notification.permission === "default") {
    document.body.addEventListener(
      "click",
      () => {
        Notification.requestPermission().catch(() => {});
      },
      { once: true },
    );
  }
}

