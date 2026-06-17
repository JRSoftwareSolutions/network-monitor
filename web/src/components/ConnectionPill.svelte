<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { connectionState } from "../lib/status";
  import { readConnectionSample, subscribeConnectionSample } from "../lib/connectionSample";

  let { pingIntervalMs = 1000 }: { pingIntervalMs?: number } = $props();

  let version = $state(0);
  let now = $state(Date.now());

  let clock: ReturnType<typeof setInterval> | null = null;
  let unsubSample: (() => void) | null = null;

  onMount(() => {
    clock = setInterval(() => {
      now = Date.now();
      version++;
    }, 1000);
    unsubSample = subscribeConnectionSample(() => {
      now = Date.now();
      version++;
    });
  });

  onDestroy(() => {
    if (clock) clearInterval(clock);
    unsubSample?.();
  });

  const conn = $derived.by(() => {
    version;
    const { lastTs, lastSuccess } = readConnectionSample();
    return connectionState(lastTs, lastSuccess, pingIntervalMs, now);
  });
</script>

<span class="pill" data-state={conn}>{conn}</span>
