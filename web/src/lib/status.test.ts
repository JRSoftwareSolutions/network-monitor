import { describe, expect, it } from "vitest";
import { connectionState, tierLabel } from "./status";
import { downsampleSamples } from "./sse";

describe("status", () => {
  it("labels tiers", () => {
    expect(tierLabel("great")).toBe("Great");
    expect(tierLabel("offline")).toBe("Offline");
  });

  it("detects stale connection", () => {
    const recent = new Date(Date.now() - 500).toISOString();
    expect(connectionState(recent, 1000)).toBe("online");
    const stale = new Date(Date.now() - 1500).toISOString();
    expect(connectionState(stale, 1000)).toBe("stale");
  });
});

describe("downsampleSamples", () => {
  it("reduces sample count", () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({
      ts: new Date(Date.now() + i).toISOString(),
      host: "1.1.1.1",
      success: true,
      latency_ms: i,
    }));
    const out = downsampleSamples(samples, 5);
    expect(out).toHaveLength(5);
  });
});
