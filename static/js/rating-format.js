function rateMetric(metric, value) {
  switch (metric) {
    case "ping":
      return value < 40 ? "great" : value < 70 ? "good" : value < 110 ? "okay" : "bad";
    case "jitter":
      return value < 8 ? "great" : value < 15 ? "good" : value < 30 ? "okay" : "bad";
    case "loss":
      return value <= 0 ? "great" : value < 1 ? "good" : value <= 3 ? "okay" : "bad";
    case "spikes":
      return value <= 0 ? "great" : value < 1 ? "good" : value <= 4 ? "okay" : "bad";
    default:
      return "none";
  }
}

function rateOutageDuration(seconds) {
  if (seconds < 30) {
    return "okay";
  }
  if (seconds < 120) {
    return "bad";
  }
  return "offline";
}

function rateOutageFailures(count) {
  if (count <= 5) {
    return "okay";
  }
  if (count <= 20) {
    return "bad";
  }
  return "offline";
}

/* Position (0-100%) on a 4-segment scale bar, aligned with rating zones. */
function scalePercent(metric, value, rating) {
  const edges = SCALE_EDGES[metric];
  const segIndex = RATING_ORDER.indexOf(rating);
  if (!edges || segIndex < 0) {
    return 0;
  }
  const lo = edges[segIndex];
  const hi = edges[segIndex + 1];
  const within = hi > lo ? clamp((value - lo) / (hi - lo), 0, 1) : 0.5;
  return (segIndex + within) * 25;
}

/* ---------- formatting ---------- */

function formatMs(value, digits = 1) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)} ms`;
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
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

function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setSlotText(el, text) {
  if (el) {
    el.textContent = text;
  }
}

function formatSlotMs(value, digits = 0) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)} ms`;
}

function formatSlotPct(value, digits = 1) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
}

function formatSlotRate(value, digits = 1) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(digits)}/min`;
}

/* ---------- number tweening (smooth value updates) ---------- */

const activeTweens = new Map();
let tweenFrame = null;

function tweenNumber(el, target, { duration = 700, decimals = 0 } = {}) {
  if (target === null || target === undefined || Number.isNaN(target)) {
    activeTweens.delete(el);
    delete el.dataset.tween;
    el.textContent = "—";
    return;
  }
  const current = Number(el.dataset.tween);
  if (!Number.isFinite(current)) {
    // First real value: snap straight to it.
    activeTweens.delete(el);
    el.dataset.tween = String(target);
    el.textContent = target.toFixed(decimals);
    return;
  }
  const existing = activeTweens.get(el);
  if (existing && Math.abs(existing.to - target) < 1e-9) {
    return;
  }
  if (Math.abs(current - target) < Math.pow(10, -decimals) / 2) {
    activeTweens.delete(el);
    el.dataset.tween = String(target);
    el.textContent = target.toFixed(decimals);
    return;
  }
  activeTweens.set(el, { from: current, to: target, start: performance.now(), duration, decimals });
  if (!tweenFrame) {
    tweenFrame = requestAnimationFrame(tweenTick);
  }
}

function tweenTick(ts) {
  for (const [el, tween] of activeTweens) {
    const progress = Math.min(1, (ts - tween.start) / tween.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = tween.from + (tween.to - tween.from) * eased;
    el.dataset.tween = String(value);
    el.textContent = value.toFixed(tween.decimals);
    if (progress >= 1) {
      activeTweens.delete(el);
    }
  }
  tweenFrame = activeTweens.size ? requestAnimationFrame(tweenTick) : null;
}
