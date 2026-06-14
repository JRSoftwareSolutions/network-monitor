import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function panelIdsFromHtml() {
  const html = fs.readFileSync(path.join(ROOT, "static", "index.html"), "utf8");
  return [...html.matchAll(/data-panel="([^"]+)"/g)].map((match) => match[1]);
}

function panelIdsFromModel() {
  const sandbox = { console, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "static", "js", "views-model.js"), "utf8"),
    context,
  );
  return sandbox.ViewsModel.PANEL_DEFS.map((panel) => panel.id);
}

test("panel ids in HTML match PANEL_DEFS", () => {
  const htmlIds = [...new Set(panelIdsFromHtml())].sort();
  const modelIds = panelIdsFromModel().sort();
  assert.equal(JSON.stringify(htmlIds), JSON.stringify(modelIds));
});
