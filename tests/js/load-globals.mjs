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

function makeCustomEvent() {
  return class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  };
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
    CustomEvent: makeCustomEvent(),
    dispatchEvent: () => {},
    addEventListener: () => {},
    localStorage,
    document: {
      getElementById: () => null,
      body: { toggleAttribute: () => {}, setAttribute: () => {}, removeAttribute: () => {} },
      addEventListener: () => {},
    },
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

function makePanelElement(panelId, { w = 12, order = 0, hidden = false } = {}) {
  const classes = new Set([`span-${w}`]);
  if (hidden) classes.add("is-panel-hidden");
  const children = [];
  const el = {
    dataset: { panel: panelId },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      *[Symbol.iterator]() { yield* classes; },
    },
    style: { order: String(order) },
    removeAttribute: () => {},
    setAttribute: () => {},
    querySelector: (sel) => children.find((c) => c.matches?.(sel)) ?? null,
    appendChild: (child) => {
      children.push(child);
      return child;
    },
  };
  return el;
}

export function loadDashboardGridWithDom(options = {}) {
  const innerWidth = options.innerWidth ?? 1280;
  const store = new Map();
  const localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };

  const panels = {};
  const gridChildren = [];

  const gridEl = {
    querySelector: (sel) => {
      const match = sel.match(/\[data-panel="([^"]+)"/);
      if (match) return panels[match[1]] ?? null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === "[data-panel]") return gridChildren.filter((el) => !el.classList.contains("is-panel-hidden"));
      return [];
    },
    addEventListener: () => {},
  };

  const sandbox = {
    innerWidth,
    CustomEvent: makeCustomEvent(),
    dispatchEvent: () => {},
    addEventListener: () => {},
    localStorage,
    document: {
      getElementById: (id) => (id === "dashboard-grid" ? gridEl : null),
      body: { toggleAttribute: () => {}, setAttribute: () => {}, removeAttribute: () => {} },
      addEventListener: () => {},
      querySelectorAll: () => [],
    },
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  runScript("views-model.js", context);
  runScript("dashboard-grid.js", context);

  const ViewsModel = sandbox.ViewsModel;
  const DashboardGrid = sandbox.DashboardGrid;
  ViewsModel.init();

  for (const panel of ViewsModel.PANEL_DEFS) {
    const meta = ViewsModel.getPanelMeta(panel.id);
    const el = makePanelElement(panel.id, { w: meta.w, order: meta.order });
    panels[panel.id] = el;
    gridChildren.push(el);
  }

  DashboardGrid.init();

  return { ViewsModel, DashboardGrid, panels, gridEl };
}
