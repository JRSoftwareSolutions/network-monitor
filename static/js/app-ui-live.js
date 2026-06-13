/* ---------- key indicators ---------- */

const METRIC_HELP = {
  ping: {
    title: "Ping",
    paragraphs: [
      "Your typical round-trip latency to the target — the steady response time you'd normally feel in-game, not a single momentary reading.",
      "Calculated as the median of successful pings over the last 60 seconds. Short spikes barely move this number, so it reflects your baseline rather than one-off blips.",
    ],
    thresholds: "Great &lt; 40 ms · Good &lt; 70 ms · Okay &lt; 110 ms · Bad â‰¥ 110 ms",
  },
  jitter: {
    title: "Jitter",
    paragraphs: [
      "How much your ping wobbles from one packet to the next. Low jitter means steady timing; high jitter feels like stutter or rubber-banding even when average ping looks fine.",
      "Average inter-arrival jitter (RFC 3550-style smoothing) across successful pings in the last 2 minutes.",
    ],
    thresholds: "Great &lt; 8 ms · Good &lt; 15 ms · Okay &lt; 30 ms · Bad â‰¥ 30 ms",
  },
  loss: {
    title: "Packet loss",
    paragraphs: [
      "The share of ping requests that never got a reply. Dropped packets make actions arrive late or not at all — you'll notice it as hitches, desync, or abilities misfiring.",
      "Failed pings divided by total pings in the last 2 minutes.",
    ],
    thresholds: "Great 0% · Good &lt; 1% · Okay â‰¤ 3% · Bad &gt; 3%",
  },
  spikes: {
    title: "Spike rate",
    paragraphs: [
      "How often latency suddenly shoots far above your normal baseline. A single bad ping is a micro-hitch; frequent spikes feel like ongoing rubber-banding.",
      "Counts pings that exceed max(2.5Ã— baseline, baseline + 80 ms) in the last 2 minutes, then expresses that as spikes per minute. The rating follows the rate, not the single worst value.",
    ],
    thresholds: "Great 0/min · Good &lt; 1/min · Okay â‰¤ 4/min · Bad &gt; 4/min",
  },
};

const CHART_HELP = {
  "live-feed": {
    title: "Live feed",
    paragraphs: [
      "The raw, unfiltered view of what's happening right now. The big number is the latest ping, and each bar in the strip is one ping — the last 60, newest on the right. Taller bars mean higher latency; a full-height red bar is a ping that never came back.",
      "Nothing here is smoothed or damped, so this row is allowed to jump around. The instant chip reads only the last few pings — treat it as a gut check, not a verdict.",
    ],
    thresholds: "Bar colors: great &lt; 40 ms · good &lt; 70 ms · fair &lt; 110 ms · poor â‰¥ 110 ms · red = failed",
  },
  "latency-blocks": {
    title: "Latency blocks",
    paragraphs: [
      "Each candle condenses one minute of pings, stock-chart style: the thin wick spans the lowest to highest latency in that minute, and the thick body runs from the first reading (open) to the last (close).",
      "Color grades the whole minute by blending packet loss, average latency and jitter — so a minute can turn amber or red from loss alone even when latency looks fine. Hover a candle for the exact numbers.",
    ],
    thresholds: "Green = good · amber = fair · red = poor — weighted blend: loss 50% · latency 35% · jitter 15%",
  },
  latency: {
    title: "Latency",
    paragraphs: [
      "Every ping's round-trip time across the selected window. The purple band hugging the line shows Â±jitter at that moment — the wider the band, the less steady the connection.",
      "Shaded horizontal zones in the background mark the quality thresholds, and thin red vertical strips mark pings that failed and therefore have no latency value.",
    ],
    thresholds: "Zones: great &lt; 40 ms · good &lt; 70 ms · fair &lt; 110 ms · poor â‰¥ 110 ms",
  },
  "jitter-chart": {
    title: "Jitter",
    paragraphs: [
      "How much the timing between pings wobbles, plotted per ping. A line hugging zero means packets arrive on a steady beat; rising jitter feels like stutter or rubber-banding even when average ping looks fine.",
      "Values use the same RFC 3550-style smoothing as the jitter indicator above, so a single odd packet won't spike the line.",
    ],
    thresholds: "Zones: great &lt; 8 ms · good &lt; 15 ms · fair &lt; 30 ms · poor â‰¥ 30 ms",
  },
  "loss-chart": {
    title: "Packet loss",
    paragraphs: [
      "The share of pings that went unanswered, bucketed per minute — one bar per minute, taller is worse. Minutes with no loss show no bar at all.",
      "Bar color reflects severity, and the dashed reference lines mark where loss starts to be noticeable. Hover a bar to see exactly how many pings failed.",
    ],
    thresholds: "Good &lt; 1% · fair â‰¤ 3% · poor &gt; 3%",
  },
};

const HELP_CONTENT = { ...METRIC_HELP, ...CHART_HELP };

const INDICATOR_DECIMALS = { ping: 0, jitter: 1, loss: 1, spikes: 1 };
const RATING_WORDS = { great: "great", good: "good", okay: "fair", bad: "poor" };

const indicatorEls = {};
for (const key of Object.keys(INDICATOR_DECIMALS)) {
  const root = document.getElementById(`ind-${key}`);
  if (!root) {
    continue;
  }
  indicatorEls[key] = {
    root,
    badge: root.querySelector('[data-role="badge"]'),
    value: root.querySelector('[data-role="value"]'),
    meaning: root.querySelector('[data-role="meaning"]'),
    marker: root.querySelector('[data-role="marker"]'),
    sub: root.querySelector('[data-role="sub"]'),
    worst: root.querySelector('[data-role="worst"]'),
    threshold: root.querySelector('[data-role="threshold"]'),
  };
}

let lastIndicatorMeaningKey = {};

function updateIndicators(now) {
  const indicators = now?.indicators ?? {};

  for (const [key, els] of Object.entries(indicatorEls)) {
    const data = indicators[key];
    if (!data || data.value === null || data.value === undefined) {
      els.root.dataset.rating = "none";
      els.badge.textContent = "—";
      tweenNumber(els.value, null);
      els.meaning.textContent = "waiting for data…";
      els.marker.style.left = "0%";
      lastIndicatorMeaningKey[key] = "";
      continue;
    }
    els.root.dataset.rating = data.level;
    els.badge.textContent = RATING_WORDS[data.level] ?? data.level;
    tweenNumber(els.value, data.value, { decimals: INDICATOR_DECIMALS[key] });

    const meaningKey = `${data.level}:${data.meaning ?? ""}`;
    if (meaningKey !== lastIndicatorMeaningKey[key]) {
      lastIndicatorMeaningKey[key] = meaningKey;
      els.meaning.textContent = data.meaning ?? "";
    }

    els.marker.style.left = `${scalePercent(key, data.value, data.level).toFixed(1)}%`;
  }

  const spikes = indicators.spikes;
  const thresholdMs = now?.spike_threshold_ms;
  if (thresholdMs != null) {
    setSlotText(indicatorEls.spikes.threshold, formatSlotMs(thresholdMs, 0));
  } else {
    setSlotText(indicatorEls.spikes.threshold, "—");
  }
  if (spikes?.worst_ms != null) {
    setSlotText(indicatorEls.spikes.worst, formatSlotMs(spikes.worst_ms, 0));
  } else {
    setSlotText(indicatorEls.spikes.worst, "—");
  }
}

/* ---------- metric help popover ---------- */

const metricPopover = document.getElementById("metric-popover");
const metricPopoverTitle = document.getElementById("metric-popover-title");
const metricPopoverBody = document.getElementById("metric-popover-body");
const metricPopoverPanel = metricPopover?.querySelector(".metric-popover__panel");
const metricPopoverClose = metricPopover?.querySelector(".metric-popover__close");
const metricPopoverBackdrop = metricPopover?.querySelector(".metric-popover__backdrop");
let activeHelpKey = null;
let activeHelpTrigger = null;

const THRESHOLD_LEVEL_WORDS = {
  great: "great",
  good: "good",
  okay: "okay",
  fair: "okay",
  poor: "bad",
  bad: "bad",
  green: "good",
  amber: "okay",
  red: "bad",
};

function colorizeThresholdText(text) {
  let html = text.replace(
    /\b(Great|Good|Okay|Bad|great|good|fair|poor|Green|amber|red)(?=\s|[<â‰¥â‰¤=·]|$)/gi,
    (match) => {
      const level = THRESHOLD_LEVEL_WORDS[match.toLowerCase()];
      if (!level) return match;
      return `<span class="metric-popover__lvl metric-popover__lvl--${level}">${match}</span>`;
    },
  );
  html = html.replace(
    /\bfailed\b/gi,
    '<span class="metric-popover__lvl metric-popover__lvl--bad">failed</span>',
  );
  return html;
}

function renderMetricHelpBody(help) {
  const parts = help.paragraphs.map((text) => `<p>${text}</p>`);
  if (help.thresholds) {
    parts.push(`<p class="metric-popover__thresholds">${colorizeThresholdText(help.thresholds)}</p>`);
  }
  metricPopoverBody.innerHTML = parts.join("");
}

function positionMetricPopover(trigger) {
  positionFloatingPanel(trigger, metricPopoverPanel);
}

function setMetricHelpExpanded(trigger, expanded) {
  if (!trigger) return;
  trigger.setAttribute("aria-expanded", String(expanded));
}

function closeMetricPopover() {
  if (!metricPopover || metricPopover.hidden) return;
  metricPopover.hidden = true;
  setMetricHelpExpanded(activeHelpTrigger, false);
  activeHelpKey = null;
  activeHelpTrigger = null;
}

function openMetricPopover(key, trigger) {
  const help = HELP_CONTENT[key];
  if (!help || !metricPopover || !trigger) return;

  if (activeHelpKey === key && !metricPopover.hidden) {
    closeMetricPopover();
    return;
  }

  if (activeHelpTrigger && activeHelpTrigger !== trigger) {
    setMetricHelpExpanded(activeHelpTrigger, false);
  }

  activeHelpKey = key;
  activeHelpTrigger = trigger;
  metricPopoverTitle.textContent = help.title;
  renderMetricHelpBody(help);

  const rating = key in INDICATOR_DECIMALS
    ? indicatorEls[key]?.root?.dataset.rating
    : null;
  if (rating && rating !== "none") {
    metricPopoverPanel.dataset.rating = rating;
  } else {
    delete metricPopoverPanel.dataset.rating;
  }

  metricPopover.hidden = false;
  setMetricHelpExpanded(trigger, true);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => positionMetricPopover(trigger));
  });
}

function initHelpPopovers() {
  if (!metricPopover) return;

  for (const key of Object.keys(INDICATOR_DECIMALS)) {
    const trigger = indicatorEls[key]?.root;
    if (!trigger) continue;

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      openMetricPopover(key, trigger);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMetricPopover(key, trigger);
      }
    });
  }

  // Native buttons already fire click on Enter/Space, so no keydown handler needed.
  for (const button of document.querySelectorAll(".panel-help-btn[data-help]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openMetricPopover(button.dataset.help, button);
    });
  }

  metricPopoverClose?.addEventListener("click", closeMetricPopover);
  metricPopoverBackdrop?.addEventListener("click", closeMetricPopover);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMetricPopover();
  });

  window.addEventListener("resize", () => {
    if (!metricPopover.hidden) positionMetricPopover(activeHelpTrigger);
  });
}

/* ---------- live feed (raw micro view) ---------- */

let heartbeatBars = [];
let lastHeartbeatTs = null;

function setBarTransition(bar, enabled) {
  if (!bar) return;
  bar.style.transition = enabled ? "" : "none";
}

function applyBarSample(bar, sample, animate = true) {
  if (!bar) return;
  setBarTransition(bar, animate);
  if (!sample) {
    bar.className = "hb-bar hb-bar--empty";
    bar.style.height = "5%";
    bar.removeAttribute("title");
    return;
  }
  if (!sample.success) {
    bar.className = "hb-bar hb-bar--fail";
    bar.style.height = "100%";
    bar.title = `${formatTime(sample.ts)} — failed`;
    return;
  }
  bar.className = `hb-bar hb-bar--${rateMetric("ping", sample.latency_ms)}`;
  bar.style.height = `${clamp((sample.latency_ms / HEARTBEAT_MAX_MS) * 100, 6, 100).toFixed(1)}%`;
  bar.title = `${formatTime(sample.ts)} — ${sample.latency_ms.toFixed(1)} ms`;
}

function copyBarState(target, source) {
  if (!target || !source) return;
  setBarTransition(target, false);
  target.className = source.className;
  target.style.height = source.style.height;
  if (source.title) {
    target.title = source.title;
  } else {
    target.removeAttribute("title");
  }
}

function shiftHeartbeatLeft() {
  for (let i = 0; i < HEARTBEAT_COUNT - 1; i += 1) {
    copyBarState(heartbeatBars[i], heartbeatBars[i + 1]);
  }
}

function fillHeartbeatFromRecent(recent) {
  const offset = HEARTBEAT_COUNT - recent.length;
  heartbeatBars.forEach((bar, index) => {
    applyBarSample(bar, recent[index - offset] ?? null, false);
  });
}

function updateHeartbeat(recent) {
  if (!heartbeatEl || heartbeatBars.length !== HEARTBEAT_COUNT) return;

  if (!recent.length) {
    lastHeartbeatTs = null;
    fillHeartbeatFromRecent([]);
    return;
  }

  const latest = recent[recent.length - 1];
  if (lastHeartbeatTs === latest.ts) {
    return;
  }

  if (lastHeartbeatTs == null) {
    fillHeartbeatFromRecent(recent);
    lastHeartbeatTs = latest.ts;
    return;
  }

  const lastIndex = recent.findIndex((sample) => sample.ts === lastHeartbeatTs);
  if (lastIndex < 0) {
    fillHeartbeatFromRecent(recent);
    lastHeartbeatTs = latest.ts;
    return;
  }

  for (const sample of recent.slice(lastIndex + 1)) {
    shiftHeartbeatLeft();
    applyBarSample(heartbeatBars[HEARTBEAT_COUNT - 1], sample, true);
  }
  lastHeartbeatTs = latest.ts;
}

function initHeartbeat() {
  if (!heartbeatEl) return;
  heartbeatEl.replaceChildren();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < HEARTBEAT_COUNT; i += 1) {
    const bar = document.createElement("span");
    bar.className = "hb-bar hb-bar--empty";
    bar.style.height = "5%";
    frag.appendChild(bar);
  }
  heartbeatEl.appendChild(frag);
  heartbeatBars = Array.from(heartbeatEl.children);
}

function updateLiveFeed(now, samples) {
  const instant = now?.instant_verdict ?? { level: "no_data", label: "No data" };
  instantChip.dataset.level = instant.level;
  instantChipLabel.textContent = instant.label;

  const latest = samples?.[samples.length - 1];
  if (!latest) {
    livePing.textContent = "—";
    livePing.dataset.rating = "none";
    livePingSub.textContent = "—";
  } else if (latest.success) {
    livePing.textContent = String(Math.round(latest.latency_ms));
    livePing.dataset.rating = rateMetric("ping", latest.latency_ms);
    livePingSub.textContent = formatTime(latest.ts);
  } else {
    livePing.textContent = "âœ•";
    livePing.dataset.rating = "bad";
    livePingSub.textContent = `${formatTime(latest.ts)} · failed`;
  }

  const recent = (samples ?? []).slice(-HEARTBEAT_COUNT);
  updateHeartbeat(recent);
}


/* ---------- window select ---------- */

function getWindowMinutes() {
  const value = Number(windowSelect?.value);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function populateWindowOptions(options, defaultWindow) {
  if (!windowSelect) {
    return;
  }
  windowSelect.innerHTML = "";
  for (const minutes of options) {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = `${minutes} minutes`;
    windowSelect.appendChild(option);
  }

  const stored = localStorage.getItem(WINDOW_STORAGE_KEY);
  if (stored && options.includes(Number(stored))) {
    windowSelect.value = stored;
    return;
  }
  if (defaultWindow && options.includes(defaultWindow)) {
    windowSelect.value = String(defaultWindow);
  }
}

