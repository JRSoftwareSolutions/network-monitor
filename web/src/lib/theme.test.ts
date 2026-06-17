import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chartTheme, cssVar } from "./theme";

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
    getStore(el).set("--chart-height", "380px");
    expect(cssVar("--chart-height", el)).toBe("380px");
  });

  it("parses chart height from CSS", () => {
    document.documentElement.style.setProperty("--chart-height", "260px");
    expect(chartTheme().height).toBe(260);
  });

  it("reads chart height from a passed element", () => {
    const el = {} as Element;
    getStore(el).set("--chart-height", "380px");
    expect(chartTheme(el).height).toBe(380);
  });

  it("builds chart theme from tokens", () => {
    document.documentElement.style.setProperty("--color-accent", "#38bdf8");
    document.documentElement.style.setProperty("--color-text-muted", "#94a3b8");
    document.documentElement.style.setProperty("--color-chart-envelope", "#64748b");
    document.documentElement.style.setProperty(
      "--color-chart-envelope-fill",
      "rgba(56, 189, 248, 0.12)",
    );
    document.documentElement.style.setProperty("--chart-height", "260px");
    expect(chartTheme()).toEqual({
      seriesStroke: "#38bdf8",
      axisStroke: "#94a3b8",
      envelopeStroke: "#64748b",
      envelopeFill: "rgba(56, 189, 248, 0.12)",
      height: 260,
    });
  });
});
