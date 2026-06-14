/* ---------- dashboard formatting and DOM helpers ---------- */

window.DashboardFormat = (() => {
  const dash = "-";

  function fmt(value, digits, unit) {
    if (value === null || value === undefined || Number.isNaN(value)) return dash;
    const n = Number(value);
    const text = digits === 0 ? Math.round(n).toString() : n.toFixed(digits);
    return unit ? `${text}${unit}` : text;
  }

  const fmtMs = (v, d = 0) => fmt(v, d, "");
  const fmtPct = (v) => fmt(v, v != null && Number(v) < 10 ? 1 : 0, "%");

  function timeOfDay(ts) {
    if (!ts) return dash;
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function hhmm(ts) {
    if (!ts) return dash;
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function duration(seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function agoText(ms) {
    const s = Math.round(ms / 1000);
    if (s < 2) return "just now";
    if (s < 60) return `${s}s ago`;
    return `${Math.round(s / 60)}m ago`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  const $ = (id) => document.getElementById(id);
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

  return {
    dash,
    fmt,
    fmtMs,
    fmtPct,
    timeOfDay,
    hhmm,
    duration,
    agoText,
    escapeHtml,
    $,
    setText,
  };
})();
