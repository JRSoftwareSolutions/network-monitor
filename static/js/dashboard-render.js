/* ---------- dashboard panel rendering ---------- */

window.DashboardRender = (() => {
  const F = window.DashboardFormat;
  const R = window.DashboardRating;
  const Sparkline = window.DashboardSparkline;
  const { dash, fmt, fmtMs, fmtPct, timeOfDay, hhmm, duration, escapeHtml, $, setText } = F;
  const { COLORS, SCALE, ratePing, applyAccent, bucketQuality } = R;

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

  function updateIndicatorSparklines(now, indicatorSeries) {
    if (!appState) return;
    appState.sparklineNow = now || {};
    const series = indicatorSeries || {};
    for (const key of ["ping", "jitter", "loss", "spikes"]) {
      const card = $(`ind-${key}`);
      if (!card) continue;
      const canvas = card.querySelector('[data-role="sparkline"]');
      const level = now && now.indicators && now.indicators[key] ? now.indicators[key].level : "none";
      const values = series[key] || [];
      Sparkline.draw(canvas, values, {
        min: 0,
        max: SCALE[key][4],
        thresholds: SCALE[key].slice(1, 4),
        color: COLORS[level] || COLORS.none,
      });
    }
  }

  function renderIndicators(now) {
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
