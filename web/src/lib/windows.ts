export const LIVE_WINDOW_SECONDS = 60;

export const CHART_BASELINE_POINTS = 300;

export interface MetricBinding {
  title: (selectedMinutes: number) => string;
}

/** Chart bin width for a rolling window (~CHART_BASELINE_POINTS buckets). */
export function displayBucketSeconds(windowMinutes: number): number {
  return (windowMinutes * 60) / CHART_BASELINE_POINTS;
}

export const DASHBOARD_METRICS = {
  connection: {
    title: (m) => `Connection (${m} min)`,
  },
  latencyChart: {
    title: (m) => `Latency (${m} min)`,
  },
  live: {
    title: (_m) => `Live (${LIVE_WINDOW_SECONDS}s)`,
  },
} as const satisfies Record<string, MetricBinding>;
