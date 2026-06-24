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
  live_window_seconds: number;
}

export interface Sample {
  ts: string;
  host: string;
  success: boolean;
  latency_ms?: number;
  jitter_ms?: number;
}

export interface ChartBucket {
  ts: string;
  avg_ms?: number | null;
  min_ms?: number | null;
  max_ms?: number | null;
  avg_jitter_ms?: number | null;
  min_jitter_ms?: number | null;
  max_jitter_ms?: number | null;
  sample_count: number;
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
  last_ts?: string;
  last_success: boolean;
  latency_ms?: number;
  min_latency_ms?: number;
  max_latency_ms?: number;
  jitter_ms?: number;
  min_jitter_ms?: number;
  max_jitter_ms?: number;
  loss_percent: number;
  sample_count: number;
  success_count: number;
}

export interface SpeedTestResult {
  id?: number;
  ts: string;
  download_mbps?: number | null;
  upload_mbps?: number | null;
  duration_seconds: number;
  error?: string | null;
}

export interface SpeedTestProgress {
  phase: "download" | "upload";
  mbps: number;
}

export interface SpeedTestStatus {
  running: boolean;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function getConfig() {
  return fetchJson<AppConfig>("/api/config");
}

export function getSummary(minutes: number) {
  return fetchJson<Summary>(`/api/summary?minutes=${minutes}`);
}

export function getChartBuckets(minutes: number) {
  return fetchJson<{ buckets: ChartBucket[]; window_minutes: number; bucket_seconds: number }>(
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

export function getSpeedTestStatus() {
  return fetchJson<SpeedTestStatus>("/api/speedtest");
}

export function runSpeedTest(durationSeconds = 10) {
  const timeoutMs = (durationSeconds * 2 + 15) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchJson<SpeedTestResult>("/api/speedtest", {
    method: "POST",
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

export function getSpeedTestResults(limit = 50) {
  return fetchJson<{ results: SpeedTestResult[] }>(`/api/speedtest/results?limit=${limit}`);
}
