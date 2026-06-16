export interface Thresholds {
  ping_great: number;
  ping_good: number;
  ping_okay: number;
  ping_max: number;
  jitter_great: number;
  jitter_good: number;
  jitter_okay: number;
  jitter_max: number;
  loss_good: number;
  loss_okay: number;
  loss_max: number;
}

export interface AppConfig {
  target: string;
  ping_interval_seconds: number;
  retention_minutes: number;
  listen_host: string;
  listen_port: number;
  thresholds: Thresholds;
  window_options_minutes: number[];
}

export interface Sample {
  ts: string;
  host: string;
  success: boolean;
  latency_ms?: number;
  jitter_ms?: number;
}

export interface Summary {
  window_minutes: number;
  sample_count: number;
  success_count: number;
  loss_percent: number;
  avg_latency_ms?: number;
  min_latency_ms?: number;
  max_latency_ms?: number;
  p95_latency_ms?: number;
  avg_jitter_ms?: number;
  status: "great" | "ok" | "poor" | "offline";
}

export interface LiveMetrics {
  latency_ms?: number;
  jitter_ms?: number;
  loss_percent: number;
  sample_count: number;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function getConfig() {
  return fetchJson<AppConfig>("/api/config");
}

export function getSummary(minutes: number) {
  return fetchJson<Summary>(`/api/summary?minutes=${minutes}`);
}

export function getSamples(minutes: number) {
  return fetchJson<{ samples: Sample[]; window_minutes: number }>(
    `/api/samples?minutes=${minutes}`,
  );
}

export function getLive() {
  return fetchJson<LiveMetrics>("/api/live");
}

export function putConfig(body: {
  target?: string;
  ping_interval_seconds?: number;
  retention_minutes?: number;
}) {
  return fetchJson<{ target: string; ping_interval_seconds: number; retention_minutes: number }>(
    "/api/config",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
