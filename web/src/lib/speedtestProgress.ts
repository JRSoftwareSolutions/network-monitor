import type { SpeedTestProgress } from "./api";
import { createBus } from "./createBus";

type Listener = (progress: SpeedTestProgress) => void;

const bus = createBus<SpeedTestProgress>();

export function publishSpeedTestProgress(progress: SpeedTestProgress): void {
  bus.publish(progress);
}

export function subscribeSpeedTestProgress(listener: Listener): () => void {
  return bus.subscribe(listener);
}

/** Test helper */
export function resetSpeedTestProgress(): void {
  bus.reset();
}
