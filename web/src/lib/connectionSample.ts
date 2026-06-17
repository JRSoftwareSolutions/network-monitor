import { createBus } from "./createBus";

type Listener = () => void;

let lastTs: string | null = null;
let lastSuccess: boolean | null = null;
const bus = createBus<null>();

export function adoptConnectionSample(ts: string, success: boolean): void {
  if (!lastTs || Date.parse(ts) >= Date.parse(lastTs)) {
    lastTs = ts;
    lastSuccess = success;
    bus.publish(null);
  }
}

export function readConnectionSample(): { lastTs: string | null; lastSuccess: boolean | null } {
  return { lastTs, lastSuccess };
}

export function subscribeConnectionSample(listener: Listener): () => void {
  return bus.subscribe(() => listener());
}

/** Test helper */
export function resetConnectionSample(): void {
  lastTs = null;
  lastSuccess = null;
  bus.reset();
}
