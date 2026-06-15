import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JS = path.join(ROOT, "static", "js");

function loadDashboardCharts() {
  const sandbox = { console, structuredClone: globalThis.structuredClone };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, "dashboard-rating.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(JS, "dashboard-format.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(JS, "dashboard-charts.js"), "utf8"), context);
  return sandbox.DashboardCharts;
}

test("mergeRecentIntoLineSamples appends newer live tail", () => {
  const DC = loadDashboardCharts();
  const samples = [
    { ts: "2026-01-01T12:00:00.000Z", latency_ms: 20 },
    { ts: "2026-01-01T12:04:00.000Z", latency_ms: 22 },
  ];
  const recent = [
    { ts: "2026-01-01T12:04:30.000Z", latency_ms: 24 },
    { ts: "2026-01-01T12:05:00.000Z", latency_ms: 21 },
  ];
  const merged = DC.mergeRecentIntoLineSamples(samples, recent);
  assert.equal(merged.length, 4);
  assert.equal(merged[merged.length - 1].ts, "2026-01-01T12:05:00.000Z");
});

test("chart tail is older than server latest_ts so knownTs stays behind server", () => {
  const DC = loadDashboardCharts();
  const samples = [
    { ts: "2026-01-01T12:00:00.000Z", latency_ms: 20 },
    { ts: "2026-01-01T12:04:00.000Z", latency_ms: 22 },
  ];
  const recent = [
    { ts: "2026-01-01T12:04:30.000Z", latency_ms: 24 },
    { ts: "2026-01-01T12:05:00.000Z", latency_ms: 21 },
  ];
  const payload = {
    window_minutes: 30,
    latest_ts: "2026-01-01T12:05:30.000Z",
    samples,
    recent_samples: recent,
  };
  const chartTail = DC.chartLineSamples(payload).at(-1).ts;
  const serverLatest = payload.latest_ts;
  assert.ok(new Date(chartTail).valueOf() < new Date(serverLatest).valueOf());
  assert.notEqual(chartTail, serverLatest);
});

test("trimSamplesToWindow drops points outside selected window", () => {
  const DC = loadDashboardCharts();
  const samples = [
    { ts: "2026-01-01T11:50:00.000Z", latency_ms: 18 },
    { ts: "2026-01-01T12:00:00.000Z", latency_ms: 20 },
    { ts: "2026-01-01T12:04:00.000Z", latency_ms: 22 },
    { ts: "2026-01-01T12:05:00.000Z", latency_ms: 21 },
  ];
  const trimmed = DC.trimSamplesToWindow(samples, 5, "2026-01-01T12:05:00.000Z");
  assert.equal(trimmed.length, 3);
  assert.equal(trimmed[0].ts, "2026-01-01T12:00:00.000Z");
});
