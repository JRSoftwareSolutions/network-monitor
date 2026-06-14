/* ---------- indicator sparkline canvas rendering ---------- */

window.DashboardSparkline = (() => {
  const R = window.DashboardRating;
  const { COLORS, GRID } = R;

  function draw(canvas, values, opts) {
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

  return { draw };
})();
