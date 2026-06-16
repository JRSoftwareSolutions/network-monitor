<script lang="ts">
  import { onMount } from "svelte";
  import type { Sample } from "../lib/api";
  import { buildLatencySeries, createLatencyChart, updateLatencyChart } from "../lib/charts";
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  let { samples = [] as Sample[] }: { samples?: Sample[] } = $props();

  let container: HTMLDivElement;
  let chart: uPlot | null = null;

  onMount(() => {
    const { times, latency } = buildLatencySeries(samples);
    chart = createLatencyChart(container, times, latency);

    const ro = new ResizeObserver(() => {
      if (chart && container) {
        chart.setSize({ width: container.clientWidth, height: 260 });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart?.destroy();
    };
  });

  $effect(() => {
    if (!chart) return;
    const { times, latency } = buildLatencySeries(samples);
    updateLatencyChart(chart, times, latency);
  });
</script>

<section class="card chart-card">
  <h2>Latency</h2>
  <div class="chart-wrap" bind:this={container}></div>
</section>
