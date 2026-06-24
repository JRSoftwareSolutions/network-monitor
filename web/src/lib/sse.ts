import type { ChartBucket } from "./api";

export type SSEHandler = (type: string, data: unknown) => void;

export class SSEClient {
  private source: EventSource | null = null;
  private handler: SSEHandler;
  private onReconnect?: () => void;
  private retryMs = 1000;
  private hadDisconnect = false;

  constructor(handler: SSEHandler, onReconnect?: () => void) {
    this.handler = handler;
    this.onReconnect = onReconnect;
  }

  connect() {
    this.source?.close();
    const source = new EventSource("/api/events");
    this.source = source;

    source.onopen = () => {
      if (this.hadDisconnect) {
        this.onReconnect?.();
        this.hadDisconnect = false;
      }
    };

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
      this.hadDisconnect = true;
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
