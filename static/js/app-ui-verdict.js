/* ---------- shared UI helpers ---------- */

function updatePendingVerdictUI(pending, { root, labelEl, secEl, labels }) {
  if (!root) {
    return;
  }
  if (!pending) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.dataset.direction = pending.direction;
  labelEl.textContent = pending.direction === "up" ? labels.up : labels.down;
  setSlotText(
    secEl,
    String(Math.max(0, Math.ceil(pending.needed_seconds - pending.for_seconds))),
  );
}

function positionFloatingPanel(trigger, panel, { hAlign = "center", flipVertical = true } = {}) {
  if (!panel || !trigger) return;

  const margin = 12;
  const gap = 10;
  const rect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  let top = rect.bottom + gap;
  if (flipVertical && top + panelRect.height > window.innerHeight - margin) {
    top = rect.top - panelRect.height - gap;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - panelRect.height - margin));

  let left = hAlign === "right"
    ? rect.right - panelRect.width
    : rect.left + rect.width / 2 - panelRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin));

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

/* ---------- hero: stabilized verdict + smoothed readout ---------- */

const ARC_LENGTH = arcValue?.getTotalLength?.() ?? 0;
if (arcValue && ARC_LENGTH > 0) {
  arcValue.style.strokeDasharray = `${ARC_LENGTH} ${ARC_LENGTH}`;
  arcValue.style.strokeDashoffset = String(ARC_LENGTH);
}

function setArc(baseline) {
  if (!arcValue) {
    return;
  }
  if (baseline === null || baseline === undefined) {
    arcValue.style.strokeDashoffset = String(ARC_LENGTH);
    return;
  }
  const rating = rateMetric("ping", baseline);
  const frac = clamp(scalePercent("ping", baseline, rating) / 100, 0.02, 1);
  arcValue.style.strokeDashoffset = String(ARC_LENGTH * (1 - frac));
}

const TREND_LABELS = {
  improving: "improving",
  steady: "steady",
  degrading: "degrading",
  unknown: "trend pending",
};

function updateTrend(trend) {
  const direction = trend?.direction ?? "unknown";
  trendPill.dataset.trend = direction;
  trendLabel.textContent = TREND_LABELS[direction] ?? TREND_LABELS.unknown;

  const delta = trend?.latency_delta_ms;
  if ((direction === "improving" || direction === "degrading") && delta != null && Math.abs(delta) >= 1) {
    const sign = delta > 0 ? "+" : "−";
    trendDelta.hidden = false;
    trendDelta.textContent = `${sign}${Math.abs(delta).toFixed(0)} ms vs prior 10 min`;
  } else {
    trendDelta.hidden = true;
    trendDelta.textContent = "";
  }
}

function updateHeroDetail(indicators) {
  const ping = indicators.ping;
  const jitter = indicators.jitter;
  const loss = indicators.loss;

  setSlotText(
    verdictBaseline,
    ping?.value != null ? formatSlotMs(ping.value, 0) : "—",
  );
  setSlotText(
    verdictJitter,
    jitter?.value != null ? formatSlotMs(jitter.value, 1) : "—",
  );
  setSlotText(
    verdictLoss,
    loss?.value != null ? formatSlotPct(loss.value, 1) : "—",
  );
}

function updateHero(now) {
  const display = now?.display_verdict ?? { level: "no_data", label: "No data", since_seconds: 0, pending: null };
  const indicators = now?.indicators ?? {};

  document.body.dataset.level = display.level;
  hero.dataset.level = display.level;
  verdictLabel.textContent = display.label;
  updateHeroDetail(indicators);

  if (display.level !== "no_data" && display.since_seconds != null) {
    verdictSince.hidden = false;
    setSlotText(verdictSinceVal, formatDuration(Math.max(1, Math.floor(display.since_seconds))));
  } else {
    verdictSince.hidden = true;
  }

  updatePendingVerdictUI(display.pending, {
    root: verdictPending,
    labelEl: verdictPendingLabel,
    secEl: verdictPendingSec,
    labels: { up: "improving — confirming", down: "checking slowdown —" },
  });

  const baseline = now?.baseline_ms ?? null;
  if (baseline != null) {
    heroReadout.dataset.rating = rateMetric("ping", baseline);
  } else {
    heroReadout.dataset.rating = display.level === "offline" ? "bad" : "none";
  }
  tweenNumber(baselineValue, baseline, { decimals: 0 });
  setArc(baseline);

  updateTrend(now?.trend);
  updateTabTitle(baseline, display);
}

function buildWindowNarrative(stats, outages) {
  if (!stats?.sample_count) {
    return "Waiting for samples in this window…";
  }

  const parts = [`${formatPercent(stats.uptime_pct)} uptime`];
  if (stats.latency_avg_ms != null) {
    parts.push(`${stats.latency_avg_ms.toFixed(1)} ms avg`);
  }
  if (stats.packet_loss_pct > 0) {
    parts.push(`${formatPercent(stats.packet_loss_pct)} loss`);
  }

  const resolved = (outages ?? []).filter((outage) => !outage.ongoing);
  if (resolved.length === 1) {
    parts.push(`1 outage (${formatDuration(resolved[0].duration_seconds)})`);
  } else if (resolved.length > 1) {
    parts.push(`${resolved.length} outages`);
  }
  if ((outages ?? []).some((outage) => outage.ongoing)) {
    parts.push("ongoing outage");
  }

  return parts.join(" · ");
}

function updateWindowSummary(health, stats, outages, windowMinutes) {
  const level = health?.level ?? "no_data";
  const label = health?.label ?? "No data";
  const avgLatency = stats?.latency_avg_ms ?? null;

  document.body.dataset.level = level;
  hero.dataset.level = level;
  verdictLabel.textContent = label;
  windowSummaryNarrative.textContent = buildWindowNarrative(stats, outages);

  verdictSince.hidden = true;
  verdictPending.hidden = true;

  if (avgLatency != null) {
    heroReadout.dataset.rating = rateMetric("ping", avgLatency);
  } else {
    heroReadout.dataset.rating = HEALTH_TO_RATING[level] ?? "none";
  }
  tweenNumber(baselineValue, avgLatency, { decimals: 0 });
  setArc(avgLatency);

  if (heroKickerText) {
    heroKickerText.textContent = `window summary · last ${windowMinutes} min`;
  }
  if (readoutCaption) {
    readoutCaption.innerHTML = "window avg latency";
  }

  if (avgLatency != null) {
    document.title = `${Math.round(avgLatency)} ms avg · ${label}`;
  } else {
    document.title = `${label} · Network Monitor`;
  }
  setFavicon(HEALTH_TO_RATING[level] ?? level);
}

function needsHistoryVisualizations(view) {
  return ViewBuilder.needsHistoryVisualizations(view);
}

function updateTabTitle(baseline, display) {
  if (display.level === "no_data") {
    document.title = "Network Monitor";
  } else if (baseline != null) {
    document.title = `${Math.round(baseline)} ms · ${display.label}`;
  } else {
    document.title = `${display.label} · Network Monitor`;
  }
  setFavicon(display.level);
}

function setFavicon(level) {
  if (level === lastFaviconLevel) {
    return;
  }
  lastFaviconLevel = level;
  const color = LEVEL_COLORS[level] ?? LEVEL_COLORS.no_data;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
    "<rect width='32' height='32' rx='8' fill='#0a101c'/>" +
    "<path d='M6 20c4-6 8-9 10-9s6 3 10 9' stroke='#3de8ff' stroke-width='2.5' fill='none' stroke-linecap='round'/>" +
    `<circle cx='16' cy='22' r='2.5' fill='${color}'/>` +
    "</svg>";
  faviconLink.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ---------- current status narrative ---------- */

const STATUS_HEADLINES = {
  great: "Rock solid",
  good: "Stable",
  okay: "A bit shaky",
  bad: "Unstable",
  offline: "Connection down",
  no_data: "Waiting for data",
};

const STATUS_SUMMARIES = {
  great: "Ideal for competitive play — latency, jitter, and loss are all in great shape.",
  good: "Smooth for nearly any game — nothing here should get in your way.",
  okay: "Playable, but fast-paced games may feel occasional hitches.",
  bad: "Expect noticeable lag in real-time games until this improves.",
  offline: "Online games will freeze or disconnect until the connection recovers.",
  no_data: "Waiting for the first pings to come in…",
};

const TREND_NOTES = {
  improving: "Latency is trending down versus the prior 10 minutes.",
  steady: "Latency has been steady over the last 20 minutes.",
  degrading: "Latency is trending up versus the prior 10 minutes.",
  unknown: "Not enough history yet to judge a trend.",
};

let lastStatusSummaryKey = "";
let lastStatusNoteKey = {};

function updateStatusMetricRow(key, { valueText, noteText, hasData = true }) {
  const row = statusMetrics[key];
  if (!row) {
    return;
  }
  setSlotText(row.value, valueText);
  const nextNote = noteText ?? (hasData ? row.note.textContent : "—");
  if (nextNote !== lastStatusNoteKey[key]) {
    lastStatusNoteKey[key] = nextNote;
    row.note.textContent = nextNote;
  }
}

function updateStatusChipSlot(key, indicator) {
  const slot = statusChipSlots[key];
  if (!slot) {
    return;
  }
  if (!indicator || indicator.value === null || indicator.value === undefined) {
    slot.root.hidden = true;
    return;
  }

  slot.root.hidden = false;
  slot.root.dataset.level = indicator.level;

  let valueText = "—";
  switch (key) {
    case "ping":
      valueText = formatSlotMs(indicator.value, 0);
      break;
    case "jitter":
      valueText = formatSlotMs(indicator.value, 1);
      break;
    case "loss":
      valueText = formatSlotPct(indicator.value, 1);
      break;
    case "spikes":
      valueText = formatSlotRate(indicator.value, 1);
      break;
    default:
      break;
  }
  setSlotText(slot.value, valueText);
}

function updateStatusPending(display) {
  updatePendingVerdictUI(display?.pending, {
    root: statusPending,
    labelEl: statusPendingLabel,
    secEl: statusPendingSec,
    labels: { up: "Improving — confirming", down: "Possible slowdown — checking" },
  });
}

function updateStatusPanel(now) {
  const display = now?.display_verdict ?? { level: "no_data" };
  const level = display.level ?? "no_data";
  const indicators = now?.indicators ?? {};
  const trend = now?.trend;

  statusPanel.dataset.level = level;
  statusPanel.dataset.stable = display.since_seconds >= 8 ? "true" : "false";
  statusHeadline.textContent = STATUS_HEADLINES[level] ?? STATUS_HEADLINES.no_data;

  if (level === "no_data") {
    for (const key of Object.keys(statusMetrics)) {
      updateStatusMetricRow(key, { valueText: "—", noteText: "—", hasData: false });
    }
    for (const key of Object.keys(statusChipSlots)) {
      statusChipSlots[key].root.hidden = true;
    }
    statusSummary.textContent = STATUS_SUMMARIES.no_data;
    lastStatusSummaryKey = "no_data";
    updateStatusPending(display);
    return;
  }

  if (level === "offline") {
    updateStatusMetricRow("ping", { valueText: "—", noteText: "No response from target" });
    updateStatusMetricRow("jitter", { valueText: "—", noteText: "—", hasData: false });
    updateStatusMetricRow("loss", {
      valueText: formatSlotPct(indicators.loss?.value ?? 100, 1),
      noteText: indicators.loss?.meaning ?? "Connection appears down",
    });
    updateStatusMetricRow("spikes", { valueText: "—", noteText: "—", hasData: false });
    updateStatusMetricRow("trend", { valueText: "—", noteText: "—", hasData: false });
  } else {
    updateStatusMetricRow("ping", {
      valueText: formatSlotMs(indicators.ping?.value, 0),
      noteText: indicators.ping?.meaning ?? "—",
      hasData: indicators.ping?.value != null,
    });
    updateStatusMetricRow("jitter", {
      valueText: formatSlotMs(indicators.jitter?.value, 1),
      noteText: indicators.jitter?.meaning ?? "—",
      hasData: indicators.jitter?.value != null,
    });
    updateStatusMetricRow("loss", {
      valueText: formatSlotPct(indicators.loss?.value, 1),
      noteText: indicators.loss?.meaning ?? "—",
      hasData: indicators.loss?.value != null,
    });
    updateStatusMetricRow("spikes", {
      valueText: formatSlotRate(indicators.spikes?.value, 1),
      noteText: indicators.spikes?.meaning ?? "—",
      hasData: indicators.spikes?.value != null,
    });

    const trendDirection = trend?.direction ?? "unknown";
    updateStatusMetricRow("trend", {
      valueText: TREND_LABELS[trendDirection] ?? TREND_LABELS.unknown,
      noteText: TREND_NOTES[trendDirection] ?? TREND_NOTES.unknown,
    });
  }

  for (const key of Object.keys(statusChipSlots)) {
    updateStatusChipSlot(key, indicators[key]);
  }

  const summaryKey = `${level}:${trend?.direction ?? "unknown"}:${indicators.spikes?.level ?? "none"}`;
  if (summaryKey !== lastStatusSummaryKey) {
    lastStatusSummaryKey = summaryKey;
    statusSummary.textContent = STATUS_SUMMARIES[level] ?? STATUS_SUMMARIES.no_data;
  }

  updateStatusPending(display);
}

