import uPlot from "uplot";
import type { Sample } from "./api";
import { parseTs } from "./sse";

export function buildLatencySeries(samples: Sample[]): {
  times: number[];
  latency: (number | null)[];
} {
  const times: number[] = [];
  const latency: (number | null)[] = [];
  for (const s of samples) {
    times.push(parseTs(s.ts) / 1000);
    latency.push(s.success && s.latency_ms != null ? s.latency_ms : null);
  }
  return { times, latency };
}

export function createLatencyChart(
  el: HTMLElement,
  times: number[],
  latency: (number | null)[],
): uPlot {
  const data: uPlot.AlignedData = [times, latency];
  const opts: uPlot.Options = {
    width: el.clientWidth || 640,
    height: 260,
    series: [
      {},
      {
        label: "Latency",
        stroke: "#38bdf8",
        width: 2,
        spanGaps: false,
      },
    ],
    axes: [
      { stroke: "#94a3b8" },
      { stroke: "#94a3b8", label: "ms" },
    ],
    scales: {
      x: { time: true },
    },
  };
  return new uPlot(opts, data, el);
}

export function updateLatencyChart(chart: uPlot, times: number[], latency: (number | null)[]) {
  chart.setData([times, latency]);
}
