import test from "node:test";
import assert from "node:assert/strict";
import { loadDashboardGridGlobals, loadDashboardGridWithDom } from "./load-globals.mjs";

test("normalizeLayoutItem clamps width and preserves order", () => {
  const { DashboardGrid } = loadDashboardGridGlobals();
  const item = DashboardGrid.normalizeLayoutItem("hero", {
    w: 20,
    order: 0,
  });
  assert.equal(item.w, 12);
  assert.equal(item.order, 0);
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

test("normalizeLayoutItem uses minW/maxW from unified panel defs", () => {
  const { DashboardGrid, ViewsModel } = loadDashboardGridGlobals();
  const distribution = ViewsModel.getPanelMeta("distribution");
  const item = DashboardGrid.normalizeLayoutItem("distribution", { w: 20, order: 7 });
  assert.equal(item.w, distribution.maxW);
  const clamped = DashboardGrid.normalizeLayoutItem("distribution", { w: 1, order: 7 });
  assert.equal(clamped.w, distribution.minW);
});

test("readLayoutFromDom reads span width and order from panel elements", () => {
  const { DashboardGrid, panels } = loadDashboardGridWithDom();
  for (const cls of panels.hero.classList) {
    if (cls.startsWith("span-")) panels.hero.classList.remove(cls);
  }
  panels.hero.classList.add("span-10");
  panels.hero.style.order = "5";
  const layout = DashboardGrid.readLayoutFromDom();
  assert.equal(layout.hero.w, 10);
  assert.equal(layout.hero.order, 5);
});

test("reorderPanel moves panel before target in layout order", () => {
  const { DashboardGrid, panels } = loadDashboardGridWithDom();
  DashboardGrid.reorderPanel("recent", "hero");
  const layout = DashboardGrid.readLayoutFromDom();
  assert.ok(layout.recent.order < layout.hero.order);
  assert.match([...panels.recent.classList].join(" "), /^span-/);
});
