const root = () => document.documentElement;

export function cssVar(name: string, el?: Element): string {
  const target = el ?? root();
  return getComputedStyle(target).getPropertyValue(name).trim();
}

function remToPx(value: string, el?: Element): number {
  const match = value.match(/^([\d.]+)rem$/);
  if (!match) return 0;
  const fontSize = parseFloat(cssVar("font-size", el ?? root())) || 16;
  return Math.round(parseFloat(match[1]) * fontSize);
}

export function chartMinHeight(el?: Element): number {
  const raw = cssVar("--layout-chart-min-height", el);
  if (!raw) return 260;
  if (raw.endsWith("rem")) return remToPx(raw, el) || 260;
  return parseInt(raw, 10) || 260;
}

export function chartHeight(el?: Element): number {
  if (el && "clientHeight" in el) {
    const measured = (el as { clientHeight: number }).clientHeight;
    if (measured > 0) return measured;
  }
  return chartMinHeight(el);
}

export function chartTheme(el?: Element) {
  const themeEl = el ?? root();
  return {
    seriesStroke: cssVar("--color-accent", themeEl),
    axisStroke: cssVar("--color-text-muted", themeEl),
    envelopeStroke: cssVar("--color-chart-envelope", themeEl),
    envelopeFill: cssVar("--color-chart-envelope-fill", themeEl),
    height: chartHeight(themeEl),
  };
}
