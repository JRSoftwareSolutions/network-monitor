import type { Sample } from "./api";

export type SSEHandler = (type: string, data: unknown) => void;

export class SSEClient {
  private source: EventSource | null = null;
  private handler: SSEHandler;
  private retryMs = 1000;

  constructor(handler: SSEHandler) {
    this.handler = handler;
  }

  connect() {
    this.source?.close();
    const source = new EventSource("/api/events");
    this.source = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type: string; data: unknown };
        this.handler(payload.type, payload.data);
        this.retryMs = 1000;
      } catch {
        // ignore malformed frames
      }
    };

    source.onerror = () => {
      source.close();
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
    };
  }

  close() {
    this.source?.close();
    this.source = null;
  }
}

export function parseTs(ts: string): number {
  return Date.parse(ts);
}

export function filterSamplesByWindow(samples: Sample[], minutes: number): Sample[] {
  const cutoff = Date.now() - minutes * 60_000;
  return samples.filter((s) => parseTs(s.ts) >= cutoff);
}

export function downsampleSamples(samples: Sample[], maxPoints: number): Sample[] {
  if (samples.length <= maxPoints) {
    return samples;
  }
  const step = (samples.length - 1) / (maxPoints - 1);
  const out: Sample[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(samples[Math.round(i * step)]);
  }
  return out;
}
