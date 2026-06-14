const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadChartPluginGlobals } = require("./load-globals.js");

test("bucketBadness weights loss heavily", () => {
  const { bucketBadness } = loadChartPluginGlobals();
  const clean = bucketBadness({ loss_pct: 0, avg_ms: 20, jitter_avg_ms: 2 });
  const lossy = bucketBadness({ loss_pct: 10, avg_ms: 20, jitter_avg_ms: 2 });
  assert.ok(lossy > clean);
});

test("badnessToQuality tiers", () => {
  const { badnessToQuality } = loadChartPluginGlobals();
  assert.equal(badnessToQuality(0.1), "good");
  assert.equal(badnessToQuality(0.5), "fair");
  assert.equal(badnessToQuality(0.8), "poor");
});

test("lossBarColor severity", () => {
  const { lossBarColor } = loadChartPluginGlobals();
  assert.match(lossBarColor(0.5), /209, 255/);
  assert.match(lossBarColor(2), /194, 77/);
  assert.match(lossBarColor(5), /93, 108/);
});

test("latencyReferenceLines includes baseline, avg and p95", () => {
  const { latencyReferenceLines } = loadChartPluginGlobals();
  const lines = latencyReferenceLines({ latency_avg_ms: 25.4, latency_p95_ms: 48.2 }, 42);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].value, 42);
  assert.equal(lines[1].value, 25.4);
  assert.equal(lines[2].value, 48.2);
});

test("computeRollingMedianSeries smooths spikes", () => {
  const { computeRollingMedianSeries } = loadChartPluginGlobals();
  const base = Date.now() - 120_000;
  const samples = [
    { ts: new Date(base).toISOString(), success: true, latency_ms: 20 },
    { ts: new Date(base + 3000).toISOString(), success: true, latency_ms: 22 },
    { ts: new Date(base + 6000).toISOString(), success: true, latency_ms: 200 },
    { ts: new Date(base + 9000).toISOString(), success: true, latency_ms: 24 },
  ];
  const series = computeRollingMedianSeries(samples);
  assert.ok(series.length >= 3);
  const spikePoint = series.find((point) => point.y >= 100);
  assert.equal(spikePoint, undefined);
});

test("computeLatencyYMax includes baseline", () => {
  const { computeLatencyYMax } = loadChartPluginGlobals();
  assert.equal(computeLatencyYMax([{ y: 30 }], null, 130), 150);
});

test("computeLatencyYMax fits low-latency traffic without dead space", () => {
  const { computeLatencyYMax } = loadChartPluginGlobals();
  const data = [{ y: 18 }, { y: 22 }, { y: 20 }];
  const bandUpper = [{ y: 26 }, { y: 28 }, { y: 25 }];
  assert.equal(
    computeLatencyYMax(data, { latency_p95_ms: 23, latency_max_ms: 248 }, 18, bandUpper),
    35,
  );
  assert.equal(computeLatencyYMax([{ y: 30 }], null), 35);
});

test("computeLatencyYMax still expands for visible spikes", () => {
  const { computeLatencyYMax } = loadChartPluginGlobals();
  const data = [{ y: 15 }, { y: 180 }];
  assert.equal(computeLatencyYMax(data, { latency_p95_ms: 160 }), 210);
});

test("computeJitterYMax fits low jitter without a fixed floor", () => {
  const { computeJitterYMax } = loadChartPluginGlobals();
  assert.equal(computeJitterYMax([{ y: 2.1 }, { y: 3.4 }, { y: 2.8 }]), 5);
  assert.equal(computeJitterYMax([{ y: 9 }, { y: 11 }]), 14);
});

test("computeJitterYMax still expands for visible spikes", () => {
  const { computeJitterYMax } = loadChartPluginGlobals();
  const data = [{ y: 3 }, { y: 22 }];
  assert.equal(computeJitterYMax(data), 30);
});
