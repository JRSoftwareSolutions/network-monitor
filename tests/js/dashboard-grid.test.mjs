import test from "node:test";
import assert from "node:assert/strict";
import { loadDashboardGridGlobals } from "./load-globals.mjs";

test("normalizeLayoutItem clamps width and preserves order", () => {
  const { DashboardGrid } = loadDashboardGridGlobals();
  const item = DashboardGrid.normalizeLayoutItem("hero", {
    w: 20,
    order: 0,
  });
  assert.equal(item.w, 12);
  assert.equal(item.order, 0);
  assert.equal(item.size, undefined);
});

test("normalizeLayoutItem forces single column below breakpoint", () => {
  const { DashboardGrid } = loadDashboardGridGlobals({ innerWidth: 640 });
  const item = DashboardGrid.normalizeLayoutItem("outages", {
    w: 6,
    order: 11,
  });
  assert.equal(item.w, 12);
});

test("normalizeLayoutMap fills all default panels", () => {
  const { DashboardGrid, ViewsModel } = loadDashboardGridGlobals();
  ViewsModel.init();
  const map = DashboardGrid.normalizeLayoutMap("default", { hero: { w: 12 } });
  assert.equal(Object.keys(map).length, ViewsModel.PANEL_DEFS.length);
  assert.equal(map.hero.w, 12);
  assert.ok(map.recent);
});

test("normalizeLayoutItem migrates legacy GridStack records", () => {
  const { DashboardGrid } = loadDashboardGridGlobals();
  const item = DashboardGrid.normalizeLayoutItem("latency", {
    x: 0,
    y: 11,
    w: 8,
    h: 4,
    size: "tall",
  });
  assert.equal(item.w, 8);
  assert.equal(item.order, 1100);
  assert.equal(item.size, undefined);
});
