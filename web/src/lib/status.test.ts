import { describe, expect, it } from "vitest";
import {
  connectionQualityPercent,
  connectionState,
  DEFAULT_THRESHOLDS,
  formatCount,
  lostPackets,
  tierLabel,
} from "./status";

describe("status", () => {
  const now = Date.parse("2026-06-16T10:00:10.000Z");
  const intervalMs = 1000;

  function ts(secondsAgo: number): string {
    return new Date(now - secondsAgo * 1000).toISOString();
  }

  it("labels tiers", () => {
    expect(tierLabel("great")).toBe("Great");
    expect(tierLabel("offline")).toBe("Offline");
  });

  it("online when last ping succeeded and sample is fresh", () => {
    expect(connectionState(ts(1), true, intervalMs, now)).toBe("online");
  });

  it("stale when last ping failed", () => {
    expect(connectionState(ts(1), false, intervalMs, now)).toBe("stale");
  });

  it("stale when collector silent for 3+ intervals", () => {
    expect(connectionState(ts(5), true, intervalMs, now)).toBe("stale");
  });

  it("offline when collector silent for 10+ intervals", () => {
    expect(connectionState(ts(11), true, intervalMs, now)).toBe("offline");
  });

  it("offline when no sample timestamp", () => {
    expect(connectionState(null, null, intervalMs, now)).toBe("offline");
  });

  it("formats packet counts", () => {
    expect(formatCount(3)).toBe("3");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(undefined)).toBe("—");
  });

  it("computes lost packets", () => {
    expect(lostPackets(10, 8)).toBe(2);
    expect(lostPackets(5, 5)).toBe(0);
    expect(lostPackets(undefined, 0)).toBeUndefined();
  });

  describe("connectionQualityPercent", () => {
    const th = DEFAULT_THRESHOLDS;

    it("returns 100 when offline or no data", () => {
      expect(connectionQualityPercent(null, th)).toBe(100);
      expect(connectionQualityPercent({ sample_count: 0, success_count: 0, loss_percent: 0 }, th)).toBe(100);
      expect(connectionQualityPercent({ sample_count: 5, success_count: 0, loss_percent: 0 }, th)).toBe(100);
      expect(
        connectionQualityPercent(
          { sample_count: 10, success_count: 8, loss_percent: th.loss_max, avg_latency_ms: 20 },
          th,
        ),
      ).toBe(100);
    });

    it("scores great connections near zero", () => {
      expect(
        connectionQualityPercent(
          {
            sample_count: 10,
            success_count: 10,
            loss_percent: 0,
            avg_latency_ms: 20,
            avg_jitter_ms: 3,
          },
          th,
        ),
      ).toBe(0);
    });

    it("scores ok connections in the low range", () => {
      const score = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0.5,
          avg_latency_ms: 60,
          avg_jitter_ms: 10,
        },
        th,
      );
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(25);
    });

    it("scores poor connections higher than ok", () => {
      const ok = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0.5,
          avg_latency_ms: 60,
          avg_jitter_ms: 10,
        },
        th,
      );
      const poor = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 2,
          avg_latency_ms: 100,
          avg_jitter_ms: 25,
        },
        th,
      );
      expect(poor).toBeGreaterThan(ok);
    });

    it("treats missing jitter conservatively", () => {
      const withJitter = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0,
          avg_latency_ms: 20,
          avg_jitter_ms: 3,
        },
        th,
      );
      const withoutJitter = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0,
          avg_latency_ms: 20,
        },
        th,
      );
      expect(withoutJitter).toBeGreaterThan(withJitter);
    });

    it("increases with higher latency", () => {
      const low = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0,
          avg_latency_ms: 50,
          avg_jitter_ms: 3,
        },
        th,
      );
      const high = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0,
          avg_latency_ms: 120,
          avg_jitter_ms: 3,
        },
        th,
      );
      expect(high).toBeGreaterThan(low);
    });
  });
});
