import { describe, expect, it } from "vitest";
import { SPEED_BAR_MAX_MBPS, speedBarPercent } from "./speedBar";

describe("speedBarPercent", () => {
  it("returns 0 for zero or negative input", () => {
    expect(speedBarPercent(0)).toBe(0);
    expect(speedBarPercent(-10)).toBe(0);
  });

  it("maps Mbps to percent of fixed max", () => {
    expect(speedBarPercent(500, 1000)).toBe(50);
    expect(speedBarPercent(1000, 1000)).toBe(100);
  });

  it("clamps above max", () => {
    expect(speedBarPercent(1500, 1000)).toBe(100);
  });

  it("returns 0 when max is zero or negative", () => {
    expect(speedBarPercent(100, 0)).toBe(0);
    expect(speedBarPercent(100, -1)).toBe(0);
  });

  it("defaults to SPEED_BAR_MAX_MBPS", () => {
    expect(speedBarPercent(SPEED_BAR_MAX_MBPS)).toBe(100);
    expect(speedBarPercent(SPEED_BAR_MAX_MBPS / 2)).toBe(50);
  });
});
