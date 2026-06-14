import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JS = path.join(ROOT, "static", "js");

function loadDashboardRating() {
  const sandbox = { console, structuredClone: globalThis.structuredClone };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, "dashboard-rating.js"), "utf8"), context);
  return sandbox.DashboardRating;
}

test("dashboard rating defaults match committed tier cutoffs", () => {
  const rating = loadDashboardRating();
  assert.deepEqual(rating.THRESHOLDS.ping, { great: 40, good: 70, okay: 110, max: 200 });
  assert.equal(rating.SCALE.ping.join(","), [0, 40, 70, 110, 200].join(","));
  assert.equal(rating.ratePing(39), "great");
  assert.equal(rating.ratePing(110), "bad");
});

test("bucketQuality uses server quality when present", () => {
  const rating = loadDashboardRating();
  assert.equal(rating.bucketQuality({ sample_count: 5, quality: "fair" }), "fair");
  assert.equal(rating.bucketQuality({ sample_count: 5, loss_pct: 5, avg_ms: 20 }), "poor");
});
