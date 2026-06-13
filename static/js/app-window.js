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

      return `<div class="${classes}" title="${formatBucketTooltip(bucket).replace(/"/g, "&quot;")}"></div>`;
    })
    .join("");

  qualityTimeline.dataset.windowMinutes = String(windowMinutes);
  qualityTimeline.dataset.latestTs = latestTs ?? "";
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
  const ratingPieColors = [
    `${LEVEL_COLORS.great}cc`,
    `${LEVEL_COLORS.good}cc`,
    `${LEVEL_COLORS.okay}cc`,
    `${LEVEL_COLORS.bad}cc`,
    `${LEVEL_COLORS.offline}cc`,
  ];
  const qualityPieColors = [
    "rgba(61, 255, 162, 0.82)",
    "rgba(255, 194, 77, 0.82)",
    "rgba(255, 93, 108, 0.82)",
    "rgba(143, 163, 194, 0.22)",
  ];

  const latencyCounts = countLatencyTiers(samples);
  setHistoryPieChart(historyLatencyPie, latencyCounts, DISTRIBUTION_LABELS, ratingPieColors);
  if (historyPieCaptions.latency) {
    historyPieCaptions.latency.textContent = dominantTierCaption(
      latencyCounts,
      ["Great", "Good", "Okay", "Bad", "Failed"],
      DISTRIBUTION_LABELS,
    );
  }

  const jitterCounts = countJitterTiers(samples);
  setHistoryPieChart(historyJitterPie, jitterCounts, RATING_ORDER, ratingPieColors);
  if (historyPieCaptions.jitter) {
    historyPieCaptions.jitter.textContent = dominantTierCaption(
      jitterCounts,
      ["Stable", "Moderate", "Uneven", "Volatile"],
      RATING_ORDER,
    );
  }

  const lossCounts = countLossTiers(blocks);
  setHistoryPieChart(historyLossPie, lossCounts, RATING_ORDER, ratingPieColors);
  if (historyPieCaptions.loss) {
    historyPieCaptions.loss.textContent = dominantTierCaption(
      lossCounts,
      ["Clean", "Minor", "Moderate", "Heavy"],
      RATING_ORDER,
    );
  }

  const qualityCounts = countQualityTiers(blocks);
  setHistoryPieChart(historyQualityPie, qualityCounts, ["good", "fair", "poor", "empty"], qualityPieColors);
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

  if (blocksPanelTitle) {
    blocksPanelTitle.textContent = "Connection quality timeline";
  }
  if (blocksPanelSubtitle) {
    blocksPanelSubtitle.textContent = "Each cell = 1 minute · green / amber / red = good / fair / poor";
  }

  const latencyPanelTitle = document.querySelector('[data-panel="latency"] h2');
  if (latencyPanelTitle) {
    latencyPanelTitle.textContent = "Latency trend";
  }

  updateWindowSummary(health, stats, outages, windowMins);
  updateQualityTimeline(blocks, outages, windowMins, latestTs);
  updateQualityBreakdown(blocks);
  updateHistoryPieCharts(samples, blocks);
  updateDistributionChart(samples);
  updateWindowInsights({ stats, health, outages, blocks });
  updateWorstMinutesTable(blocks);
  updateBestMinutesTable(blocks);
  updateMinuteLogTable(blocks);
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
  const recent = samples.slice(-limit).reverse();
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

