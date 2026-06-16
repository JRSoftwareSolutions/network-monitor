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

test("chartLineSamples uses server samples without client merge", () => {
  const DC = loadDashboardCharts();
  const samples = [
    { ts: "2026-01-01T12:00:00.000Z", latency_ms: 20 },
    { ts: "2026-01-01T12:04:00.000Z", latency_ms: 22 },
    { ts: "2026-01-01T12:05:00.000Z", latency_ms: 21 },
  ];
  const payload = {
    window_minutes: 30,
    latest_ts: "2026-01-01T12:05:00.000Z",
    samples,
    recent_samples: [{ ts: "2026-01-01T12:05:30.000Z", latency_ms: 99 }],
  };
  const line = DC.chartLineSamples(payload);
  assert.equal(line.length, 3);
  assert.equal(line[line.length - 1].ts, "2026-01-01T12:05:00.000Z");
  assert.equal(line[line.length - 1].latency_ms, 21);
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
