import type { Sample } from "./api";
import { createBus } from "./createBus";

type SampleListener = (sample: Sample, windowMinutes: number) => void;
type ReloadListener = (windowMinutes: number) => void;

const sampleBus = createBus<{ sample: Sample; windowMinutes: number }>();
const reloadBus = createBus<number>();

export function publishChartSample(sample: Sample, windowMinutes: number): void {
  sampleBus.publish({ sample, windowMinutes });
}

export function subscribeChartSample(listener: SampleListener): () => void {
  return sampleBus.subscribe(({ sample, windowMinutes }) => listener(sample, windowMinutes));
}

export function requestChartReload(windowMinutes: number): void {
  reloadBus.publish(windowMinutes);
}

export function subscribeChartReload(listener: ReloadListener): () => void {
  return reloadBus.subscribe(listener);
}

/** Test helper */
export function resetChartSample(): void {
  sampleBus.reset();
  reloadBus.reset();
}
