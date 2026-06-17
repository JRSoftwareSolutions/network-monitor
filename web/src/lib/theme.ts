const root = () => document.documentElement;

export function cssVar(name: string, el?: Element): string {
  const target = el ?? root();
  return getComputedStyle(target).getPropertyValue(name).trim();
}

export function chartHeight(el?: Element): number {
  return parseInt(cssVar("--chart-height", el), 10) || 260;
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
