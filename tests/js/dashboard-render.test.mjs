import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JS = path.join(ROOT, "static", "js");

function loadRenderGlobals() {
  const sandbox = {
    console,
    structuredClone: globalThis.structuredClone,
    document: {
      getElementById: () => null,
      body: { dataset: {} },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of [
    "dashboard-format.js",
    "dashboard-rating.js",
    "dashboard-sparkline.js",
    "dashboard-render.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(JS, file), "utf8"), context);
  }
  return sandbox;
}

test("renderRecent colors jitter using rateJitter", () => {
  const sandbox = loadRenderGlobals();
  const render = sandbox.DashboardRender;
  render.bindState({ sparklineNow: {} });

  const tbody = {
    innerHTML: "",
    set innerHTML(value) {
      this._html = value;
    },
    get innerHTML() {
      return this._html;
    },
  };

  sandbox.document.getElementById = (id) => (id === "recent-table" ? tbody : null);

  render.renderRecent([
    {
      ts: "2026-06-14T12:00:00.000Z",
      success: true,
      latency_ms: 20,
      jitter_ms: 5,
    },
  ]);

  assert.match(tbody.innerHTML, /5\.0 ms/);
  assert.match(tbody.innerHTML, /color:#34e2a0/);
});
