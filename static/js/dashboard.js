/* =====================================================================
   Network Monitor - ground-up frontend (no legacy dependencies)
   Talks to the existing API:
     GET  /api/config
     GET  /api/connection
     GET  /api/metrics?windowMinutes=N&knownTs=...
     GET  /api/metrics/live?knownTs=...
     POST /api/config
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- palette (mirrors the CSS rating colors) ---------- */
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

  /* Segment edges for the indicator scale bars [min, b1, b2, b3, visualMax]. */
  const SCALE = {
    ping: [0, 40, 70, 110, 200],
    jitter: [0, 8, 15, 30, 60],
    loss: [0, 0, 1, 3, 15],
    spikes: [0, 0, 1, 4, 10],
  };

  const TARGET_PRESETS = [
    { label: "Cloudflare DNS", host: "1.1.1.1" },
    { label: "Google DNS", host: "8.8.8.8" },
    { label: "Quad9 DNS", host: "9.9.9.9" },
    { label: "OpenDNS", host: "208.67.222.222" },
  ];
  const CUSTOM = "__custom__";

  /* ---------- tiny DOM helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

  /* ---------- formatting ---------- */
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

  /* latency / jitter / loss tier classification (mirrors backend) */
  function ratePing(v) { return v < 40 ? "great" : v < 70 ? "good" : v < 110 ? "okay" : "bad"; }
  function rateJitter(v) { return v < 8 ? "great" : v < 15 ? "good" : v < 30 ? "okay" : "bad"; }
  function rateLoss(v) { return v <= 0 ? "great" : v < 1 ? "good" : v <= 3 ? "okay" : "bad"; }

  /* ---------- application state ---------- */
  const state = {
    windowMinutes: 30,
    lastSampleTs: null,
    lastUpdatedAt: 0,
    lastFullRefreshAt: 0,
    config: null,
    pollTimer: null,
    connTimer: null,
    stalenessTimer: null,
    pollIntervalMs: 1000,
    fullRefreshMs: 60000,
    connRefreshMs: 120000,
    hiddenMultiplier: 10,
    sparklineNow: null,
    sparklineSamples: [],
  };
  const charts = {};

  /* =====================================================================
     RENDERING
     ===================================================================== */

  function applyAccent(level) {
    document.body.dataset.level = level || "no_data";
  }

  /* ---------- hero verdict + gauge ---------- */
  const ARC_LEN = 295.3; // length of the semicircle path in the SVG

  function renderHero(now) {
    const display = now.display_verdict || {};
    const level = display.level || "no_data";
    const flow = now;
    applyAccent(level);

    setText("verdict-label", display.label || "No data");

    const narrative = now.narrative || {};
    const sub = narrative.sentences && narrative.sentences.length
      ? narrative.sentences[0]
      : (now.instant_verdict && now.instant_verdict.reasons || []).join(" · ") || "Connection looks steady.";
    setText("verdict-sub", sub);

    setText("tag-baseline", flow.baseline_ms != null ? `${fmtMs(flow.baseline_ms)} ms` : dash);
    setText("tag-jitter", now.stats && now.stats.jitter_ms != null ? `${fmtMs(now.stats.jitter_ms, 1)} ms` : dash);
    setText("tag-loss", now.stats ? fmtPct(now.stats.loss_pct) : dash);

    /* gauge */
    const baseline = flow.baseline_ms;
    const arc = $("gauge-arc");
    if (baseline != null) {
      const frac = Math.max(0, Math.min(1, baseline / 200));
      arc.style.strokeDashoffset = String(ARC_LEN * (1 - frac));
      setText("gauge-value", fmtMs(baseline));
    } else {
      arc.style.strokeDashoffset = String(ARC_LEN);
      setText("gauge-value", dash);
    }

    /* trend */
    const trend = now.trend || { direction: "unknown" };
    const trendEl = $("trend");
    trendEl.dataset.dir = trend.direction;
    const arrows = { improving: "↓", degrading: "↑", steady: "→", unknown: "→" };
    trendEl.querySelector(".arrow").textContent = arrows[trend.direction] || "→";
    let trendLabel = { improving: "improving", degrading: "degrading", steady: "holding steady", unknown: "trend pending" }[trend.direction];
    if (trend.latency_delta_ms != null && (trend.direction === "improving" || trend.direction === "degrading")) {
      const sign = trend.latency_delta_ms > 0 ? "+" : "";
      trendLabel += ` ${sign}${fmtMs(trend.latency_delta_ms, 1)} ms`;
    }
    setText("trend-label", trendLabel);

    /* damped / pending note on the info tag */
    const infoTag = document.querySelector("#hero-tags .tag.is-info");
    if (infoTag) {
      if (display.pending) {
        const remaining = Math.max(0, (display.pending.needed_seconds || 0) - (display.pending.for_seconds || 0));
        infoTag.textContent = display.pending.direction === "up"
          ? `looks better - upgrading in ${Math.round(remaining)}s`
          : `watching a slowdown - drops in ${Math.round(remaining)}s`;
      } else if (display.since_seconds != null && level !== "no_data") {
        infoTag.textContent = `held for ${duration(display.since_seconds)} - single pings can't flip it`;
      } else {
        infoTag.textContent = "verdict is damped - single pings can't flip it";
      }
    }
  }

  /* ---------- current status ---------- */
  function renderStatus(now) {
    const narrative = now.narrative || {};
    setText("status-headline", narrative.headline || "Waiting for data");
    const ind = now.indicators || {};
    const stats = now.stats || {};

    const rows = {
      ping: { val: now.baseline_ms != null ? `${fmtMs(now.baseline_ms)} ms` : dash, ind: ind.ping },
      jitter: { val: stats.jitter_ms != null ? `${fmtMs(stats.jitter_ms, 1)} ms` : dash, ind: ind.jitter },
      loss: { val: stats.loss_pct != null ? fmtPct(stats.loss_pct) : dash, ind: ind.loss },
      spikes: { val: now.spike_rate_per_min != null ? `${fmtMs(now.spike_rate_per_min, 1)}/min` : dash, ind: ind.spikes },
    };
    for (const [key, info] of Object.entries(rows)) {
      const row = document.querySelector(`.status-row[data-metric="${key}"]`);
      if (row) row.dataset.rating = info.ind ? info.ind.level : "none";
      setText(`sm-${key}`, info.val);
      setText(`sm-${key}-note`, info.ind ? info.ind.meaning : dash);
    }
  }

  /* ---------- key indicators ---------- */
  const INDICATOR_WINDOW_MS = {
    ping: 60000,
    jitter: 120000,
    loss: 120000,
    spikes: 120000,
  };

  function sampleTsMs(sample) {
    return new Date(sample.ts).valueOf();
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function rollingSeries(samples, windowMs, reducer) {
    if (!samples.length) return [];
    return samples.map((sample, index) => {
      const endTs = sampleTsMs(sample);
      const window = samples.slice(0, index + 1).filter((s) => {
        const ts = sampleTsMs(s);
        return ts <= endTs && ts >= endTs - windowMs;
      });
      return reducer(window, endTs);
    });
  }

  function buildIndicatorSeries(key, samples, now) {
    samples = samples || [];
    switch (key) {
      case "ping":
        return rollingSeries(samples, INDICATOR_WINDOW_MS.ping, (window) => {
          const pool = window.filter((s) => s.success && s.latency_ms != null).map((s) => s.latency_ms);
          return pool.length ? median(pool) : null;
        });
      case "jitter":
        return rollingSeries(samples, INDICATOR_WINDOW_MS.jitter, (window) => {
          const pool = window.filter((s) => s.success && s.jitter_ms != null).map((s) => s.jitter_ms);
          if (!pool.length) return null;
          return pool.reduce((sum, value) => sum + value, 0) / pool.length;
        });
      case "loss":
        return rollingSeries(samples, INDICATOR_WINDOW_MS.loss, (window) => {
          if (!window.length) return null;
          const fails = window.filter((s) => !s.success).length;
          return (fails / window.length) * 100;
        });
      case "spikes": {
        const threshold = now && now.spike_threshold_ms;
        if (threshold == null) return samples.map(() => null);
        return rollingSeries(samples, INDICATOR_WINDOW_MS.spikes, (window, endTs) => {
          if (window.length < 2) return null;
          const startTs = sampleTsMs(window[0]);
          const durationMin = (endTs - startTs) / 60000;
          if (durationMin < 0.05) return null;
          const spikes = window.filter((s) => s.success && s.latency_ms != null && s.latency_ms > threshold).length;
          return spikes / durationMin;
        });
      }
      default:
        return [];
    }
  }

  function drawIndicatorSparkline(canvas, values, opts) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const valid = values.filter((v) => v != null && !Number.isNaN(v));
    const lineWidth = 1.6;
    const padBottom = Math.max(2, height * 0.1);
    const padTop = Math.max(lineWidth + 2, height * 0.18);
    const plotH = Math.max(1, height - padTop - padBottom);
    const min = opts.min ?? 0;
    const dataMax = valid.length ? Math.max(...valid) : min;
    const scaleMax = opts.max ?? (dataMax || 1);
    const max = Math.max(scaleMax, dataMax) * 1.08;
    const range = max - min || 1;
    const color = opts.color || COLORS.none;

    const yFor = (value) => {
      const y = height - padBottom - ((value - min) / range) * plotH;
      return Math.max(padTop, Math.min(height - padBottom, y));
    };

    if (opts.thresholds) {
      ctx.strokeStyle = "rgba(140, 165, 210, 0.14)";
      ctx.lineWidth = 1;
      for (const threshold of opts.thresholds) {
        const y = yFor(threshold);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    if (!valid.length) {
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height * 0.5);
      ctx.lineTo(width, height * 0.5);
      ctx.stroke();
      return;
    }

    const count = values.length;
    const xStep = count > 1 ? width / (count - 1) : 0;
    const coords = [];
    for (let i = 0; i < count; i++) {
      const value = values[i];
      if (value == null || Number.isNaN(value)) continue;
      coords.push({ x: count > 1 ? i * xStep : width / 2, y: yFor(value) });
    }

    if (coords.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(coords[0].x, coords[0].y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    coords.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.lineTo(coords[coords.length - 1].x, height - padBottom);
    ctx.lineTo(coords[0].x, height - padBottom);
    ctx.closePath();
    if (color.startsWith("#") && color.length >= 7) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.14)`;
      ctx.fill();
    }

    ctx.beginPath();
    coords.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function updateIndicatorSparklines(now, samples) {
    state.sparklineNow = now || {};
    state.sparklineSamples = samples || [];
    for (const key of ["ping", "jitter", "loss", "spikes"]) {
      const card = $(`ind-${key}`);
      if (!card) continue;
      const canvas = card.querySelector('[data-role="sparkline"]');
      const level = now && now.indicators && now.indicators[key] ? now.indicators[key].level : "none";
      const values = buildIndicatorSeries(key, samples, now);
      drawIndicatorSparkline(canvas, values, {
        min: 0,
        max: SCALE[key][4],
        thresholds: SCALE[key].slice(1, 4),
        color: COLORS[level] || COLORS.none,
      });
    }
  }

  function renderIndicators(now, samples) {
    const ind = now.indicators || {};
    const valueFmt = {
      ping: (v) => fmtMs(v, 0),
      jitter: (v) => fmtMs(v, 1),
      loss: (v) => fmt(v, v < 10 ? 1 : 0),
      spikes: (v) => fmtMs(v, 1),
    };
    for (const key of ["ping", "jitter", "loss", "spikes"]) {
      const card = $(`ind-${key}`);
      if (!card) continue;
      const data = ind[key];
      card.dataset.rating = data ? data.level : "none";
      card.querySelector('[data-role="value"]').textContent = data ? valueFmt[key](data.value) : dash;
      card.querySelector('[data-role="meaning"]').textContent = data ? data.meaning : "waiting for data...";
      card.querySelector('[data-role="badge"]').textContent = data ? data.level : dash;

      const marker = card.querySelector('[data-role="marker"]');
      if (marker) {
        const edges = SCALE[key];
        const max = edges[4];
        const v = data ? Number(data.value) : 0;
        const pct = Math.max(0, Math.min(100, (v / max) * 100));
        marker.style.left = `calc(${pct}% - 1.5px)`;
        marker.style.opacity = data ? "1" : "0";
      }
      if (key === "spikes" && data) {
        const sub = card.querySelector('[data-role="sub"]');
        if (sub) sub.textContent = data.text || "spikes above rolling baseline";
      }
    }
    updateIndicatorSparklines(now, samples);
  }

  /* ---------- live feed + heartbeat ---------- */
  let heartbeatBuilt = false;
  function buildHeartbeat() {
    const wrap = $("heartbeat");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (let i = 0; i < 60; i++) {
      const bar = document.createElement("span");
      bar.className = "hb-bar";
      bar.style.height = "4px";
      wrap.appendChild(bar);
    }
    heartbeatBuilt = true;
  }
  function renderLive(now, recent) {
    if (!heartbeatBuilt) buildHeartbeat();
    const bars = $("heartbeat").children;
    const samples = (recent || []).slice(-60);
    const offset = bars.length - samples.length;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const sample = i >= offset ? samples[i - offset] : null;
      if (!sample) { bar.style.height = "4px"; bar.dataset.rating = "none"; bar.title = ""; continue; }
      if (!sample.success || sample.latency_ms == null) {
        bar.style.height = "100%";
        bar.dataset.rating = "fail";
        bar.title = `${timeOfDay(sample.ts)} · failed`;
      } else {
        const h = Math.max(8, Math.min(100, (sample.latency_ms / 150) * 100));
        bar.style.height = `${h}%`;
        bar.dataset.rating = ratePing(sample.latency_ms);
        bar.title = `${timeOfDay(sample.ts)} · ${fmtMs(sample.latency_ms)} ms`;
      }
    }

    const last = samples.length ? samples[samples.length - 1] : null;
    const liveEl = $("live-ping");
    if (last && last.success && last.latency_ms != null) {
      liveEl.textContent = fmtMs(last.latency_ms);
      liveEl.dataset.rating = ratePing(last.latency_ms);
      setText("live-ping-time", timeOfDay(last.ts));
    } else if (last) {
      liveEl.textContent = "fail";
      liveEl.dataset.rating = "fail";
      setText("live-ping-time", timeOfDay(last.ts));
    } else {
      liveEl.textContent = dash;
      liveEl.dataset.rating = "none";
      setText("live-ping-time", dash);
    }
  }

  /* ---------- narrative ---------- */
  function renderNarrative(now) {
    const narrative = now.narrative || {};
    const el = $("narrative");
    const sentences = narrative.sentences && narrative.sentences.length
      ? narrative.sentences
      : ["Waiting for the first pings to come in..."];
    el.innerHTML = sentences.map((s) => `<p>${escapeHtml(s)}</p>`).join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ---------- window stats + health ---------- */
  function renderStats(stats) {
    stats = stats || {};
    setText("st-avg", stats.latency_avg_ms != null ? `${fmtMs(stats.latency_avg_ms)} ms` : dash);
    setText("st-min", stats.latency_min_ms != null ? `${fmtMs(stats.latency_min_ms)} ms` : dash);
    setText("st-max", stats.latency_max_ms != null ? `${fmtMs(stats.latency_max_ms)} ms` : dash);
    setText("st-p95", stats.latency_p95_ms != null ? `${fmtMs(stats.latency_p95_ms)} ms` : dash);
    setText("st-jitter", stats.jitter_avg_ms != null ? `${fmtMs(stats.jitter_avg_ms, 1)} ms` : dash);
    setText("st-loss", fmtPct(stats.packet_loss_pct));
    setText("st-uptime", fmtPct(stats.uptime_pct));
    setText("st-samples", stats.sample_count != null ? String(stats.sample_count) : dash);
  }
  function renderHealth(health) {
    health = health || { level: "no_data", label: "No data", reasons: [] };
    const chip = $("health-chip");
    chip.dataset.level = health.level;
    setText("health-label", health.label);
    chip.title = (health.reasons || []).join(" · ");
  }

  /* ---------- quality classification for minute buckets ---------- */
  function bucketQuality(b) {
    if (!b || !b.sample_count) return "empty";
    const loss = b.loss_pct || 0;
    const avg = b.avg_ms;
    const jit = b.jitter_avg_ms;
    if (loss > 3 || (avg != null && avg >= 110) || (jit != null && jit >= 30)) return "poor";
    if (loss >= 1 || (avg != null && avg >= 70) || (jit != null && jit >= 15)) return "fair";
    return "good";
  }

  function renderTimeline(blocks) {
    const el = $("quality-timeline");
    if (!el) return;
    const buckets = (blocks && blocks.buckets) || [];
    el.innerHTML = "";
    for (const b of buckets) {
      const cell = document.createElement("span");
      cell.className = "tl-cell";
      const q = bucketQuality(b);
      cell.dataset.q = q;
      cell.title = b.sample_count
        ? `${hhmm(b.ts_start)} · ${q} · avg ${fmtMs(b.avg_ms)} ms · loss ${fmtPct(b.loss_pct)}`
        : `${hhmm(b.ts_start)} · no data`;
      el.appendChild(cell);
    }
  }

  /* ---------- tables ---------- */
  function renderOutages(outages) {
    const body = $("outages-table");
    outages = outages || [];
    if (!outages.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty">No outages in this window</td></tr>';
      return;
    }
    body.innerHTML = outages.map((o) => {
      const status = o.ongoing
        ? '<span class="badge live">ongoing</span>'
        : '<span class="badge bad">recovered</span>';
      return `<tr class="fail">
        <td class="mono">${timeOfDay(o.start_ts)}</td>
        <td class="mono">${o.ongoing ? "-" : timeOfDay(o.end_ts)}</td>
        <td class="num">${duration(o.duration_seconds)}</td>
        <td class="num">${o.failed_count}</td>
        <td>${status}</td>
      </tr>`;
    }).join("");
  }

  function renderRecent(samples) {
    const body = $("recent-table");
    samples = (samples || []).slice().reverse().slice(0, 30);
    if (!samples.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">Waiting for data...</td></tr>';
      return;
    }
    body.innerHTML = samples.map((s) => {
      if (!s.success || s.latency_ms == null) {
        return `<tr class="fail">
          <td class="mono">${timeOfDay(s.ts)}</td>
          <td class="num">-</td>
          <td class="num">-</td>
          <td><span class="badge bad">failed</span></td>
        </tr>`;
      }
      const lc = COLORS[ratePing(s.latency_ms)];
      const jc = s.jitter_ms != null ? COLORS[rateJitter(s.jitter_ms)] : TICK;
      return `<tr>
        <td class="mono">${timeOfDay(s.ts)}</td>
        <td class="num" style="color:${lc}">${fmtMs(s.latency_ms)} ms</td>
        <td class="num" style="color:${jc}">${s.jitter_ms != null ? fmtMs(s.jitter_ms, 1) + " ms" : "-"}</td>
        <td><span class="badge ok">ok</span></td>
      </tr>`;
    }).join("");
  }

  /* =====================================================================
     CHARTS
     ===================================================================== */
  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = TICK;
    Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.animation = { duration: 350 };
  }

  const baseTimeScale = () => ({
    type: "time",
    time: { unit: "minute", tooltipFormat: "HH:mm:ss", displayFormats: { minute: "HH:mm", hour: "HH:mm" } },
    grid: { color: GRID, drawTicks: false },
    border: { display: false },
    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
  });

  function initCharts() {
    chartDefaults();
    if (!window.Chart) return;

    charts.latency = new Chart($("latency-chart"), {
      type: "line",
      data: { datasets: [
        { label: "latency", data: [], borderColor: COLORS.good, backgroundColor: "rgba(78,200,255,0.10)",
          borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false },
        { label: "baseline", data: [], borderColor: COLORS.none, borderWidth: 1.3, borderDash: [5, 5],
          pointRadius: 0, fill: false, spanGaps: true },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: {
          x: baseTimeScale(),
          y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, title: { display: true, text: "ms" } },
        },
        plugins: { legend: { display: true, labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } } },
      },
    });

    charts.jitter = new Chart($("jitter-chart"), {
      type: "line",
      data: { datasets: [{ label: "jitter", data: [], borderColor: COLORS.okay,
        backgroundColor: "rgba(255,200,97,0.12)", borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: { x: baseTimeScale(), y: { beginAtZero: true, grid: { color: GRID }, border: { display: false } } },
        plugins: { legend: { display: false } },
      },
    });

    charts.loss = new Chart($("loss-chart"), {
      type: "bar",
      data: { labels: [], datasets: [{ label: "loss %", data: [], backgroundColor: [], borderRadius: 3, maxBarThickness: 26 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true, max: 100, grid: { color: GRID }, border: { display: false }, ticks: { callback: (v) => v + "%" } },
        },
        plugins: { legend: { display: false } },
      },
    });

    charts.distribution = new Chart($("distribution-chart"), {
      type: "bar",
      data: { labels: ["great", "good", "okay", "bad", "failed"],
        datasets: [{ data: [0, 0, 0, 0, 0],
          backgroundColor: [COLORS.great, COLORS.good, COLORS.okay, COLORS.bad, COLORS.offline],
          borderRadius: 5, maxBarThickness: 56 }] },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: "y",
        scales: {
          x: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { precision: 0 } },
          y: { grid: { display: false }, border: { display: false } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.x} pings` } } },
      },
    });

    charts.blocks = new Chart($("blocks-chart"), {
      type: "bar",
      data: { labels: [], datasets: [{ label: "avg latency", data: [], backgroundColor: [], borderRadius: 2, maxBarThickness: 14 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, title: { display: true, text: "avg ms" } },
        },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: (c) => `avg ${fmtMs(c.parsed.y)} ms` } } },
      },
    });
  }

  function updateCharts(payload) {
    if (!window.Chart) return;
    const samples = payload.samples || [];
    const blocks = payload.blocks || { buckets: [] };
    const now = payload.now || {};

    /* latency */
    if (charts.latency) {
      const points = samples.map((s) => ({ x: new Date(s.ts).valueOf(), y: s.success ? s.latency_ms : null }));
      charts.latency.data.datasets[0].data = points;
      const baseline = now.baseline_ms;
      if (baseline != null && samples.length) {
        charts.latency.data.datasets[1].data = [
          { x: new Date(samples[0].ts).valueOf(), y: baseline },
          { x: new Date(samples[samples.length - 1].ts).valueOf(), y: baseline },
        ];
      } else {
        charts.latency.data.datasets[1].data = [];
      }
      charts.latency.update("none");
    }

    /* jitter */
    if (charts.jitter) {
      charts.jitter.data.datasets[0].data = samples.map((s) => ({ x: new Date(s.ts).valueOf(), y: s.jitter_ms ?? null }));
      charts.jitter.update("none");
    }

    /* loss per minute */
    if (charts.loss) {
      const buckets = blocks.buckets || [];
      charts.loss.data.labels = buckets.map((b) => hhmm(b.ts_start));
      charts.loss.data.datasets[0].data = buckets.map((b) => b.sample_count ? b.loss_pct : 0);
      charts.loss.data.datasets[0].backgroundColor = buckets.map((b) => {
        const l = b.loss_pct || 0;
        return l > 3 ? COLORS.bad : l >= 1 ? COLORS.okay : COLORS.great;
      });
      charts.loss.update("none");
    }

    /* distribution from samples */
    if (charts.distribution) {
      const counts = { great: 0, good: 0, okay: 0, bad: 0, failed: 0 };
      for (const s of samples) {
        if (!s.success || s.latency_ms == null) counts.failed++;
        else counts[ratePing(s.latency_ms)]++;
      }
      charts.distribution.data.datasets[0].data = [counts.great, counts.good, counts.okay, counts.bad, counts.failed];
      charts.distribution.update("none");
    }

    /* blocks avg latency colored by quality */
    if (charts.blocks) {
      const buckets = blocks.buckets || [];
      charts.blocks.data.labels = buckets.map((b) => hhmm(b.ts_start));
      charts.blocks.data.datasets[0].data = buckets.map((b) => b.avg_ms ?? null);
      charts.blocks.data.datasets[0].backgroundColor = buckets.map((b) => {
        const q = bucketQuality(b);
        return q === "poor" ? COLORS.bad : q === "fair" ? COLORS.okay : q === "good" ? COLORS.great : GRID;
      });
      charts.blocks.update("none");
    }
  }

  /* =====================================================================
     STALENESS / STATUS PILL
     ===================================================================== */
  function setStatusPill(stateName, text) {
    const pill = $("status-pill");
    if (pill) pill.dataset.state = stateName;
    setText("status-text", text);
  }
  function updateStaleness() {
    if (!state.lastUpdatedAt) { setText("updated-pill", dash); return; }
    setText("updated-pill", agoText(Date.now() - state.lastUpdatedAt));
  }

  /* =====================================================================
     DATA APPLY
     ===================================================================== */
  function applyLive(payload) {
    const now = payload.now || {};
    renderHero(now);
    renderStatus(now);
    renderIndicators(now, payload.recent_samples);
    renderLive(now, payload.recent_samples);
    renderNarrative(now);
    state.lastUpdatedAt = Date.now();
    updateStaleness();
    const has = Boolean((payload.recent_samples || []).length);
    setStatusPill(has ? "live" : "waiting", has ? "Live" : "Waiting for data...");
  }

  function applyFull(payload) {
    const now = payload.now || {};
    const windowMins = payload.window_minutes ?? state.windowMinutes;
    setText("window-label", String(windowMins));

    renderHero(now);
    renderStatus(now);
    renderIndicators(now, payload.recent_samples);
    renderLive(now, payload.recent_samples || payload.samples);
    renderNarrative(now);
    renderStats(payload.stats);
    renderHealth(payload.health);
    renderTimeline(payload.blocks);
    renderOutages(payload.outages);
    renderRecent(payload.recent_samples || payload.samples);
    updateCharts(payload);

    state.lastUpdatedAt = Date.now();
    state.lastFullRefreshAt = Date.now();
    updateStaleness();
    const has = Boolean((payload.samples || []).length);
    setStatusPill(has ? "live" : "waiting", has ? "Live" : "Waiting for data...");
  }

  /* =====================================================================
     FETCHING
     ===================================================================== */
  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function poll(forceFull) {
    try {
      if (document.hidden && !forceFull) {
        const live = await fetchJson(`/api/metrics/live${state.lastSampleTs ? `?knownTs=${encodeURIComponent(state.lastSampleTs)}` : ""}`);
        if (!live.unchanged && live.latest_ts) state.lastSampleTs = live.latest_ts;
        return;
      }

      const needFull = forceFull || !state.lastFullRefreshAt || Date.now() - state.lastFullRefreshAt >= state.fullRefreshMs;
      if (needFull) {
        const params = new URLSearchParams({ windowMinutes: String(state.windowMinutes) });
        if (!forceFull && state.lastSampleTs) params.set("knownTs", state.lastSampleTs);
        const payload = await fetchJson(`/api/metrics?${params.toString()}`);
        if (payload.unchanged) { state.lastFullRefreshAt = Date.now(); return; }
        state.lastSampleTs = payload.latest_ts ?? null;
        applyFull(payload);
        return;
      }

      const live = await fetchJson(`/api/metrics/live${state.lastSampleTs ? `?knownTs=${encodeURIComponent(state.lastSampleTs)}` : ""}`);
      if (live.unchanged) return;
      state.lastSampleTs = live.latest_ts ?? null;
      applyLive(live);
    } catch (err) {
      console.error(err);
      setStatusPill("error", "Connection error");
    }
  }

  async function refreshConnection() {
    try {
      const c = await fetchJson("/api/connection");
      let label = "Unknown connection";
      if (c.type && c.name) label = `${c.type} · ${c.name}`;
      else if (c.type) label = c.type;
      else if (c.name) label = c.name;
      setText("connection-label", label);
    } catch (err) {
      console.error("connection refresh failed", err);
    }
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer);
    const interval = document.hidden ? state.pollIntervalMs * state.hiddenMultiplier : state.pollIntervalMs;
    state.pollTimer = setTimeout(async () => { await poll(false); schedulePoll(); }, interval);
  }
  function scheduleConnection() {
    clearTimeout(state.connTimer);
    state.connTimer = setTimeout(async () => { await refreshConnection(); scheduleConnection(); }, state.connRefreshMs);
  }

  /* =====================================================================
     CONFIG + WINDOW SELECT
     ===================================================================== */
  function populateWindowOptions(options, selected) {
    const select = $("window-select");
    select.innerHTML = "";
    const stored = Number(localStorage.getItem("nm.windowMinutes"));
    const value = stored && options.includes(stored) ? stored : selected;
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = String(opt);
      o.textContent = `${opt} min`;
      select.appendChild(o);
    }
    select.value = String(value);
    state.windowMinutes = value;
  }

  function applyConfig(config) {
    state.config = config;
    setText("target-label", config.target || dash);
    populateWindowOptions(config.window_options && config.window_options.length ? config.window_options : [5, 15, 30, 60, 120], config.default_window_minutes || 30);
    state.pollIntervalMs = Math.max(250, (config.ping_interval_seconds || 1) * 1000);
    if (config.full_refresh_seconds != null) state.fullRefreshMs = config.full_refresh_seconds * 1000;
    if (config.connection_refresh_seconds != null) state.connRefreshMs = config.connection_refresh_seconds * 1000;
    if (config.hidden_poll_multiplier != null) state.hiddenMultiplier = config.hidden_poll_multiplier;
  }

  /* =====================================================================
     SETTINGS MODAL
     ===================================================================== */
  function initSettings() {
    const modal = $("settings-modal");
    const presetSelect = $("set-target-preset");
    const customRow = $("set-custom-row");
    const customInput = $("set-target-custom");
    const errorEl = $("settings-error");

    presetSelect.innerHTML = "";
    for (const p of TARGET_PRESETS) {
      const o = document.createElement("option");
      o.value = p.host; o.textContent = `${p.label} - ${p.host}`;
      presetSelect.appendChild(o);
    }
    const customOpt = document.createElement("option");
    customOpt.value = CUSTOM; customOpt.textContent = "Custom...";
    presetSelect.appendChild(customOpt);

    const syncCustom = () => { customRow.hidden = presetSelect.value !== CUSTOM; };

    const fields = {
      pingInterval: $("set-ping-interval"),
      fullRefresh: $("set-full-refresh"),
      connRefresh: $("set-conn-refresh"),
      hiddenMult: $("set-hidden-mult"),
      logAge: $("set-log-age"),
    };

    function open() {
      const c = state.config || {};
      const preset = TARGET_PRESETS.find((p) => p.host === c.target);
      presetSelect.value = preset ? preset.host : CUSTOM;
      customInput.value = preset ? "" : (c.target || "");
      syncCustom();
      fields.pingInterval.value = c.ping_interval_seconds ?? state.pollIntervalMs / 1000;
      fields.fullRefresh.value = c.full_refresh_seconds ?? state.fullRefreshMs / 1000;
      fields.connRefresh.value = c.connection_refresh_seconds ?? state.connRefreshMs / 1000;
      fields.hiddenMult.value = c.hidden_poll_multiplier ?? state.hiddenMultiplier;
      fields.logAge.value = c.max_log_age_minutes ?? 180;
      errorEl.textContent = "";
      modal.hidden = false;
    }
    function close() { modal.hidden = true; }

    $("settings-btn").addEventListener("click", open);
    $("settings-close").addEventListener("click", close);
    $("settings-cancel").addEventListener("click", close);
    $("settings-backdrop").addEventListener("click", close);
    presetSelect.addEventListener("change", syncCustom);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });

    $("settings-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      let target = presetSelect.value;
      if (target === CUSTOM) {
        target = customInput.value.trim();
        if (!target) { errorEl.textContent = "Custom target must not be empty"; return; }
      }
      const payload = {
        target,
        ping_interval_seconds: Number(fields.pingInterval.value),
        full_refresh_seconds: Number(fields.fullRefresh.value),
        connection_refresh_seconds: Number(fields.connRefresh.value),
        hidden_poll_multiplier: Math.round(Number(fields.hiddenMult.value)),
        max_log_age_minutes: Math.round(Number(fields.logAge.value)),
      };
      const saveBtn = $("settings-save");
      saveBtn.disabled = true; saveBtn.textContent = "Saving...";
      try {
        const res = await fetch("/api/config", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
          let detail = `Save failed (HTTP ${res.status})`;
          try { const body = await res.json(); if (typeof body.detail === "string") detail = body.detail;
            else if (Array.isArray(body.detail) && body.detail[0]) detail = String(body.detail[0].msg || detail).replace(/^Value error,\s*/, ""); } catch {}
          errorEl.textContent = detail;
          return;
        }
        applyConfig(await res.json());
        scheduleConnection();
        close();
        poll(true);
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Could not reach the server - settings not saved";
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = "Save";
      }
    });
  }

  /* =====================================================================
     BOOTSTRAP
     ===================================================================== */
  function resizeCharts() {
    for (const chart of Object.values(charts)) {
      chart?.resize();
    }
    updateIndicatorSparklines(state.sparklineNow, state.sparklineSamples);
  }

  window.addEventListener("nm:layout-change", resizeCharts);

  async function bootstrap() {
    if (window.ViewBuilder) {
      ViewBuilder.init({
        onLayoutApplied: resizeCharts,
      });
    }
    buildHeartbeat();
    try { initCharts(); } catch (err) { console.error("chart init failed", err); }
    initSettings();

    try {
      const config = await fetchJson("/api/config");
      applyConfig(config);
    } catch (err) {
      console.error("config load failed", err);
      populateWindowOptions([5, 15, 30, 60, 120], 30);
    }

    $("window-select").addEventListener("change", (e) => {
      state.windowMinutes = Number(e.target.value);
      localStorage.setItem("nm.windowMinutes", e.target.value);
      poll(true);
    });

    await Promise.all([poll(true), refreshConnection()]);
    schedulePoll();
    scheduleConnection();
    state.stalenessTimer = setInterval(updateStaleness, 1000);
    resizeCharts();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { poll(true); }
      schedulePoll();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
