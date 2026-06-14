const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadAnalyticsGlobals } = require("./load-globals.js");

test("computeWindowSpikeEvents returns empty for no samples", () => {
  const { computeWindowSpikeEvents } = loadAnalyticsGlobals();
  assert.equal(computeWindowSpikeEvents([]).length, 0);
  assert.equal(computeWindowSpikeEvents(null).length, 0);
});

test("computeWindowSpikeEvents detects latency above rolling threshold", () => {
  const { computeWindowSpikeEvents } = loadAnalyticsGlobals();
  const base = Date.parse("2026-06-14T12:00:00.000Z");
  const samples = [];

  for (let i = 0; i < 30; i += 1) {
    samples.push({
      ts: new Date(base + i * 1000).toISOString(),
      success: true,
      latency_ms: 25,
      jitter_ms: 2,
    });
  }

  samples.push({
    ts: new Date(base + 30 * 1000).toISOString(),
    success: true,
    latency_ms: 250,
    jitter_ms: 4,
  });

  const spikes = computeWindowSpikeEvents(samples);
  assert.equal(spikes.length, 1);
  assert.equal(spikes[0].y, 250);
  assert.ok(spikes[0].threshold >= 80);
});

test("buildQualityCompositionData maps minute buckets to stacked tiers", () => {
  const { buildQualityCompositionData } = loadAnalyticsGlobals();
  const buckets = [
    {
      ts_start: "2026-06-14T12:00:00.000Z",
      sample_count: 60,
      loss_pct: 0,
      avg_ms: 20,
      jitter_avg_ms: 2,
    },
    {
      ts_start: "2026-06-14T12:01:00.000Z",
      sample_count: 0,
      loss_pct: 0,
      avg_ms: null,
      jitter_avg_ms: null,
    },
  ];

  const data = buildQualityCompositionData(buckets);
  assert.equal(data.good.length, 2);
  assert.equal(data.good[0].y, 1);
  assert.equal(data.fair[0].y, 0);
  assert.equal(data.empty[1].y, 1);
});

test("buildLatencyJitterScatterData keeps successful dual-metric samples", () => {
  const { buildLatencyJitterScatterData } = loadAnalyticsGlobals();
  const points = buildLatencyJitterScatterData([
    { success: true, latency_ms: 30, jitter_ms: 4, ts: "2026-06-14T12:00:01.000Z" },
    { success: false, latency_ms: 30, jitter_ms: 4, ts: "2026-06-14T12:00:02.000Z" },
    { success: true, latency_ms: 30, jitter_ms: null, ts: "2026-06-14T12:00:03.000Z" },
  ]);

  assert.equal(points.length, 1);
  assert.equal(points[0].x, 30);
  assert.equal(points[0].y, 4);
  assert.equal(points[0].rating, "great");
});
