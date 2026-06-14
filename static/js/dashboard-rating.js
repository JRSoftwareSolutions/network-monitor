/* ---------- dashboard rating colors and tier classification ---------- */

window.DashboardRating = (() => {
  const COLORS = {
    great: "#34e2a0",
    good: "#4ec8ff",
    okay: "#ffc861",
    bad: "#ff6678",
    offline: "#ff3d63",
    fail: "#ff3d63",
    none: "#8190a8",
  };
  const TICK = "#6f7f9b";
  const GRID = "rgba(140, 165, 210, 0.10)";
  const MONO = "'JetBrains Mono', ui-monospace, monospace";

  const DEFAULT_THRESHOLDS = {
    ping: { great: 40, good: 70, okay: 110, max: 200 },
    jitter: { great: 8, good: 15, okay: 30, max: 60 },
    loss: { great: 0, good: 1, okay: 3, max: 15 },
    spikes: { great: 0, good: 1, okay: 4, max: 10 },
  };

  let THRESHOLDS = structuredClone(DEFAULT_THRESHOLDS);

  function buildScale(key) {
    const tiers = THRESHOLDS[key];
    return [0, tiers.great, tiers.good, tiers.okay, tiers.max];
  }

  function buildAllScales() {
    return {
      ping: buildScale("ping"),
      jitter: buildScale("jitter"),
      loss: buildScale("loss"),
      spikes: buildScale("spikes"),
    };
  }

  let SCALE = buildAllScales();

  function applyThresholds(next) {
    if (!next || typeof next !== "object") return;
    THRESHOLDS = {
      ping: { ...DEFAULT_THRESHOLDS.ping, ...next.ping },
      jitter: { ...DEFAULT_THRESHOLDS.jitter, ...next.jitter },
      loss: { ...DEFAULT_THRESHOLDS.loss, ...next.loss },
      spikes: { ...DEFAULT_THRESHOLDS.spikes, ...next.spikes },
    };
    SCALE = buildAllScales();
  }

  function rateByThresholds(value, key) {
    const tiers = THRESHOLDS[key];
    if (key === "loss") {
      if (value <= 0) return "great";
      if (value < tiers.good) return "good";
      if (value <= tiers.okay) return "okay";
      return "bad";
    }
    if (key === "spikes") {
      if (value <= 0) return "great";
      if (value < tiers.good) return "good";
      if (value <= tiers.okay) return "okay";
      return "bad";
    }
    if (value < tiers.great) return "great";
    if (value < tiers.good) return "good";
    if (value < tiers.okay) return "okay";
    return "bad";
  }

  function ratePing(v) { return rateByThresholds(v, "ping"); }
  function rateJitter(v) { return rateByThresholds(v, "jitter"); }
  function rateLoss(v) { return rateByThresholds(v, "loss"); }

  function bucketQuality(bucket) {
    if (!bucket || !bucket.sample_count) return "empty";
    if (bucket.quality) return bucket.quality;
    const loss = bucket.loss_pct || 0;
    const avg = bucket.avg_ms;
    const jit = bucket.jitter_avg_ms;
    const tiers = THRESHOLDS;
    if (loss > tiers.loss.okay || (avg != null && avg >= tiers.ping.okay) || (jit != null && jit >= tiers.jitter.okay)) {
      return "poor";
    }
    if (loss >= tiers.loss.good || (avg != null && avg >= tiers.ping.good) || (jit != null && jit >= tiers.jitter.good)) {
      return "fair";
    }
    return "good";
  }

  function applyAccent(level) {
    document.body.dataset.level = level || "no_data";
  }

  return {
    COLORS,
    TICK,
    GRID,
    MONO,
    get SCALE() { return SCALE; },
    get THRESHOLDS() { return THRESHOLDS; },
    applyThresholds,
    ratePing,
    rateJitter,
    rateLoss,
    bucketQuality,
    applyAccent,
  };
})();
