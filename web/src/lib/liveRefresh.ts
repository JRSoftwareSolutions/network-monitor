import { createBus } from "./createBus";

type Listener = () => void;

const bus = createBus<null>();

export function requestLiveRefresh(): void {
  bus.publish(null);
}

export function subscribeLiveRefresh(listener: Listener): () => void {
  return bus.subscribe(() => listener());
}

/** Test helper */
export function resetLiveRefresh(): void {
  bus.reset();
}
