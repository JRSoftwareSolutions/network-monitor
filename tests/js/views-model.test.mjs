import test from "node:test";
import assert from "node:assert/strict";
import { loadDashboardGridGlobals } from "./load-globals.mjs";

function initViewsModel() {
  const { ViewsModel } = loadDashboardGridGlobals();
  ViewsModel.init();
  return ViewsModel;
}

test("createCustomView copies visibility and layout from template", () => {
  const VM = initViewsModel();
  VM.setPanelVisibility("default", "hero", false);
  VM.setPanelLayout("default", "latency", { w: 6, order: 6 });

  const id = VM.createCustomView("Gaming focus", "default");
  assert.ok(id);
  assert.equal(VM.getViewLabel(id), "Gaming focus");
  assert.equal(VM.getEffectivePanelVisibility(id).hero, false);
  assert.equal(VM.getEffectivePanelLayout(id).latency.w, 6);
});

test("setPanelVisibility compacts overrides when matching default", () => {
  const VM = initViewsModel();
  VM.setPanelVisibility("default", "hero", false);
  assert.equal(VM.getEffectivePanelVisibility("default").hero, false);

  VM.setPanelVisibility("default", "hero", true);
  assert.equal(VM.getEffectivePanelVisibility("default").hero, true);
});

test("resetPanelVisibility and resetPanelLayout restore defaults", () => {
  const VM = initViewsModel();
  VM.setPanelVisibility("default", "stats", false);
  VM.setPanelLayout("default", "stats", { w: 6, order: 99 });
  VM.resetPanelVisibility("default");
  VM.resetPanelLayout("default");

  assert.equal(VM.getEffectivePanelVisibility("default").stats, true);
  assert.equal(VM.getEffectivePanelLayout("default").stats.w, 12);
});

test("deleteCustomView removes view and keeps builtin views", () => {
  const VM = initViewsModel();
  const id = VM.createCustomView("Temp");
  assert.ok(VM.deleteCustomView(id));
  assert.equal(VM.isCustomView(id), false);
  assert.ok(VM.isBuiltinView("default"));
});
