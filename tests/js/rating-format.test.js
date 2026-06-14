const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadRatingFormatGlobals } = require("./load-globals.js");

test("rateMetric ping thresholds", () => {
  const { rateMetric } = loadRatingFormatGlobals();
  assert.equal(rateMetric("ping", 20), "great");
  assert.equal(rateMetric("ping", 50), "good");
  assert.equal(rateMetric("ping", 90), "okay");
  assert.equal(rateMetric("ping", 150), "bad");
});

test("rateMetric loss thresholds", () => {
  const { rateMetric } = loadRatingFormatGlobals();
  assert.equal(rateMetric("loss", 0), "great");
  assert.equal(rateMetric("loss", 0.5), "good");
  assert.equal(rateMetric("loss", 2), "okay");
  assert.equal(rateMetric("loss", 5), "bad");
});

test("scalePercent maps value into rating segment", () => {
  const { scalePercent } = loadRatingFormatGlobals();
  assert.ok(scalePercent("ping", 20, "great") > 0);
  assert.ok(scalePercent("ping", 20, "great") < 25);
  assert.ok(scalePercent("ping", 150, "bad") >= 75);
});

test("formatDuration", () => {
  const { formatDuration } = loadRatingFormatGlobals();
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(90), "1m 30s");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(3660), "1h 1m");
});

test("clamp", () => {
  const { clamp } = loadRatingFormatGlobals();
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});
