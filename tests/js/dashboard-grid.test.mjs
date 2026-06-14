import test from "node:test";
import assert from "node:assert/strict";
import { loadDashboardGridGlobals } from "./load-globals.mjs";

test("normalizeLayoutItem clamps width and preserves size preset", () => {
  const { DashboardGrid } = loadDashboardGridGlobals();
  const item = DashboardGrid.normalizeLayoutItem("hero", {
    w: 20,
    order: 0,
    size: "tall",
  });
  assert.equal(item.w, 12);
  assert.equal(item.size, "tall");
});

test("normalizeLayoutItem forces single column below breakpoint", () => {
  const { DashboardGrid } = loadDashboardGridGlobals({ innerWidth: 640 });
  const item = DashboardGrid.normalizeLayoutItem("outages", {
    w: 6,
    order: 11,
    size: "default",
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

test("normalizeLayoutItem rejects invalid size values", () => {
  const { DashboardGrid } = loadDashboardGridGlobals();
  const item = DashboardGrid.normalizeLayoutItem("status", {
    w: 6,
    order: 1,
    size: "huge",
  });
  assert.equal(item.size, "default");
});

test("normalizeLayoutItem migrates legacy GridStack records", () => {
  const { DashboardGrid } = loadDashboardGridGlobals();
  const item = DashboardGrid.normalizeLayoutItem("latency", {
    x: 0,
    y: 11,
    w: 8,
    h: 4,
    size: "default",
  });
  assert.equal(item.w, 8);
  assert.equal(item.order, 1100);
});
