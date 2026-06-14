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

  const SCALE = {
    ping: [0, 40, 70, 110, 200],
    jitter: [0, 8, 15, 30, 60],
    loss: [0, 0, 1, 3, 15],
    spikes: [0, 0, 1, 4, 10],
  };

  function ratePing(v) { return v < 40 ? "great" : v < 70 ? "good" : v < 110 ? "okay" : "bad"; }
  function rateJitter(v) { return v < 8 ? "great" : v < 15 ? "good" : v < 30 ? "okay" : "bad"; }
  function rateLoss(v) { return v <= 0 ? "great" : v < 1 ? "good" : v <= 3 ? "okay" : "bad"; }

  function applyAccent(level) {
    document.body.dataset.level = level || "no_data";
  }

  return {
    COLORS,
    TICK,
    GRID,
    MONO,
    SCALE,
    ratePing,
    rateJitter,
    rateLoss,
    applyAccent,
  };
})();
