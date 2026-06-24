export function createBus<T>() {
  const listeners = new Set<(v: T) => void>();
  return {
    publish(v: T) {
      listeners.forEach((l) => l(v));
    },
    subscribe(l: (v: T) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    reset() {
      listeners.clear();
    },
  };
}
