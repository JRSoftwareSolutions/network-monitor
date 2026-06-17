import { describe, expect, it } from "vitest";
import { publishChartSample, resetChartSample, subscribeChartSample } from "./chartSample";
import type { Sample } from "./api";

describe("chartSample", () => {
  it("delivers samples to subscribers", () => {
    resetChartSample();
    let received: Sample | null = null;
    subscribeChartSample((sample) => {
      received = sample;
    });
    const sample: Sample = {
      ts: "2026-06-16T12:00:00.000Z",
      host: "1.1.1.1",
      success: true,
      latency_ms: 20,
    };
    publishChartSample(sample, 30);
    expect(received).toEqual(sample);
  });
});
