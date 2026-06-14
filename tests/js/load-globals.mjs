import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JS = path.join(ROOT, "static", "js");

function runScript(relativePath, context) {
  const code = fs.readFileSync(path.join(JS, relativePath), "utf8");
  vm.runInContext(code, context);
}

export function loadDashboardGridGlobals(options = {}) {
  const innerWidth = options.innerWidth ?? 1280;
  const store = new Map();
  const localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const sandbox = {
    innerWidth,
    dispatchEvent: () => {},
    localStorage,
    document: {
      getElementById: () => null,
      body: { toggleAttribute: () => {}, setAttribute: () => {}, removeAttribute: () => {} },
      addEventListener: () => {},
    },
    GridStack: undefined,
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  runScript("views-model.js", context);
  runScript("dashboard-grid.js", context);

  return {
    context,
    ViewsModel: sandbox.ViewsModel,
    DashboardGrid: sandbox.DashboardGrid,
  };
}
