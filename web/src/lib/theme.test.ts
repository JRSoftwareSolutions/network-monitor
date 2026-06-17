import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chartMinHeight, chartTheme, cssVar } from "./theme";

describe("theme", () => {
  const rootVars = new Map<string, string>();
  const elementStores = new WeakMap<Element, Map<string, string>>();

  function getStore(el: Element): Map<string, string> {
    let store = elementStores.get(el);
    if (!store) {
      store = new Map();
      elementStores.set(el, store);
    }
    return store;
  }

  beforeEach(() => {
    rootVars.clear();
    vi.stubGlobal("document", {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => {
            rootVars.set(name, value);
          },
        },
      },
    });
    vi.stubGlobal("getComputedStyle", (el: Element) => ({
      getPropertyValue: (name: string) => {
        if (el === document.documentElement) {
          return rootVars.get(name) ?? "";
        }
        return getStore(el).get(name) ?? "";
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads CSS custom properties from root by default", () => {
    document.documentElement.style.setProperty("--color-accent", "#38bdf8");
    document.documentElement.style.setProperty("--color-text-muted", "#94a3b8");
    expect(cssVar("--color-accent")).toBe("#38bdf8");
    expect(cssVar("--color-text-muted")).toBe("#94a3b8");
  });

  it("reads CSS custom properties from a passed element", () => {
    const el = {} as Element;
    getStore(el).set("--layout-chart-min-height", "20rem");
    expect(cssVar("--layout-chart-min-height", el)).toBe("20rem");
  });

  it("parses chart min height from rem tokens", () => {
    document.documentElement.style.setProperty("--layout-chart-min-height", "16rem");
    expect(chartMinHeight()).toBe(256);
  });

  it("reads chart height from container clientHeight when available", () => {
    const el = { clientHeight: 320 } as HTMLElement;
    expect(chartTheme(el).height).toBe(320);
  });

  it("falls back to chart min height when container has no height", () => {
    const el = { clientHeight: 0 } as HTMLElement;
    getStore(el).set("--layout-chart-min-height", "20rem");
    expect(chartTheme(el).height).toBe(320);
  });

  it("builds chart theme from tokens", () => {
    document.documentElement.style.setProperty("--color-accent", "#38bdf8");
    document.documentElement.style.setProperty("--color-text-muted", "#94a3b8");
    document.documentElement.style.setProperty("--color-chart-envelope", "#64748b");
    document.documentElement.style.setProperty(
      "--color-chart-envelope-fill",
      "rgba(56, 189, 248, 0.12)",
    );
    document.documentElement.style.setProperty("--layout-chart-min-height", "16rem");
    expect(chartTheme()).toEqual({
      seriesStroke: "#38bdf8",
      axisStroke: "#94a3b8",
      envelopeStroke: "#64748b",
      envelopeFill: "rgba(56, 189, 248, 0.12)",
      height: 256,
    });
  });
});
