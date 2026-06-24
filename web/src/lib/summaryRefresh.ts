import { createBus } from "./createBus";

type Listener = (windowMinutes: number) => void;

const bus = createBus<number>();

export function requestSummaryRefresh(windowMinutes: number): void {
  bus.publish(windowMinutes);
}

export function subscribeSummaryRefresh(listener: Listener): () => void {
  return bus.subscribe(listener);
}

/** Test helper */
export function resetSummaryRefresh(): void {
  bus.reset();
}
