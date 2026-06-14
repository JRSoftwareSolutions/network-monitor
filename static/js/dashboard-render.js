/* ---------- dashboard panel rendering ---------- */

window.DashboardRender = (() => {
  const F = window.DashboardFormat;
  const R = window.DashboardRating;
  const { dash, fmt, fmtMs, fmtPct, timeOfDay, hhmm, duration, escapeHtml, $, setText } = F;
  const { COLORS, GRID, SCALE, ratePing, rateJitter, rateLoss, applyAccent } = R;

  let appState = null;

  function bindState(state) {
    appState = state;
  }

  const ARC_LEN = 295.3;

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
    if (!appState) return;
    appState.sparklineNow = now || {};
    appState.sparklineSamples = samples || [];
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
  }

  const HEARTBEAT_SLOTS = 60;

  function applyHeartbeatBar(bar, sample) {
    if (!sample) {
      bar.style.height = "4px";
      bar.dataset.rating = "none";
      bar.title = "";
      return;
    }
    if (!sample.success || sample.latency_ms == null) {
      bar.style.height = "100%";
      bar.dataset.rating = "fail";
      bar.title = `${timeOfDay(sample.ts)} · failed`;
      return;
    }
    const h = Math.max(8, Math.min(100, (sample.latency_ms / 150) * 100));
    bar.style.height = `${h}%`;
    bar.dataset.rating = ratePing(sample.latency_ms);
    bar.title = `${timeOfDay(sample.ts)} · ${fmtMs(sample.latency_ms)} ms`;
  }

  function createHeartbeatBar(sample) {
    const bar = document.createElement("span");
    bar.className = "hb-bar";
    applyHeartbeatBar(bar, sample);
    return bar;
  }

  function rebuildHeartbeat(wrap, samples) {
    wrap.innerHTML = "";
    const pad = Math.max(0, HEARTBEAT_SLOTS - samples.length);
    for (let i = 0; i < pad; i++) wrap.appendChild(createHeartbeatBar(null));
    for (const sample of samples) wrap.appendChild(createHeartbeatBar(sample));
  }

  function scrollHeartbeatBar(wrap, sample) {
    if (wrap.children.length >= HEARTBEAT_SLOTS) wrap.removeChild(wrap.firstChild);
    const bar = document.createElement("span");
    bar.className = "hb-bar is-new";
    bar.style.height = "4px";
    bar.dataset.rating = "none";
    wrap.appendChild(bar);
    requestAnimationFrame(() => applyHeartbeatBar(bar, sample));
  }

  function sharedHeartbeatPrefix(prev, samples) {
    const limit = Math.min(prev.length, samples.length);
    for (let i = 0; i < limit; i++) {
      if (prev[i]?.ts !== samples[i]?.ts) return i;
    }
    return limit;
  }

  function renderLive(now, recent) {
    const wrap = $("heartbeat");
    const samples = (recent || []).slice(-HEARTBEAT_SLOTS);

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

    if (!wrap) return;
    if (!samples.length) {
      rebuildHeartbeat(wrap, []);
      if (appState) appState.heartbeatSamples = [];
      return;
    }

    if (!appState) return;
    if (last && appState.heartbeatSamples.length && appState.heartbeatSamples.at(-1)?.ts === last.ts) return;

    const prev = appState.heartbeatSamples;
    const prefix = sharedHeartbeatPrefix(prev, samples);
    const canScroll = prev.length > 0 && prefix === prev.length && samples.length > prefix;

    if (canScroll) {
      for (const sample of samples.slice(prefix)) scrollHeartbeatBar(wrap, sample);
    } else {
      rebuildHeartbeat(wrap, samples);
    }
    appState.heartbeatSamples = samples;
  }

  function renderNarrative(now) {
    const narrative = now.narrative || {};
    const el = $("narrative");
    const sentences = narrative.sentences && narrative.sentences.length
      ? narrative.sentences
      : ["Waiting for the first pings to come in..."];
    el.innerHTML = sentences.map((s) => `<p>${escapeHtml(s)}</p>`).join("");
  }

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
      const jc = s.jitter_ms != null ? COLORS[rateJitter(s.jitter_ms)] : R.TICK;
      return `<tr>
        <td class="mono">${timeOfDay(s.ts)}</td>
        <td class="num" style="color:${lc}">${fmtMs(s.latency_ms)} ms</td>
        <td class="num" style="color:${jc}">${s.jitter_ms != null ? fmtMs(s.jitter_ms, 1) + " ms" : "-"}</td>
        <td><span class="badge ok">ok</span></td>
      </tr>`;
    }).join("");
  }

  return {
    bindState,
    renderHero,
    renderStatus,
    renderIndicators,
    renderLive,
    renderNarrative,
    renderStats,
    renderHealth,
    renderTimeline,
    renderOutages,
    renderRecent,
    updateIndicatorSparklines,
    bucketQuality,
  };
})();
