import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWindowMinutes, saveWindowMinutes } from "./preferences";

describe("preferences", () => {
  const allowed = [5, 15, 30, 60];

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns fallback when nothing stored", () => {
    expect(loadWindowMinutes(allowed, 30)).toBe(30);
  });

  it("returns stored value when valid and in allowed list", () => {
    saveWindowMinutes(5);
    expect(loadWindowMinutes(allowed, 30)).toBe(5);
  });

  it("returns fallback when stored value is not in allowed list", () => {
    saveWindowMinutes(60);
    expect(loadWindowMinutes([5, 15, 30], 30)).toBe(30);
  });

  it("returns fallback when stored value is invalid", () => {
    localStorage.setItem("nm:windowMinutes", "not-a-number");
    expect(loadWindowMinutes(allowed, 30)).toBe(30);
  });
});
