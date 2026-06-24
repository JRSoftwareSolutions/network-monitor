import { describe, expect, it } from "vitest";
import {
  connectionQualityPercent,
  connectionState,
  DEFAULT_THRESHOLDS,
  formatCount,
  jitterQuality,
  latencyQuality,
  lostPackets,
  lossQuality,
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

  describe("metric quality", () => {
    const th = DEFAULT_THRESHOLDS;

    it("returns unknown for missing values", () => {
      expect(latencyQuality(undefined, th)).toBe("unknown");
      expect(jitterQuality(null, th)).toBe("unknown");
      expect(lossQuality(undefined, th)).toBe("unknown");
    });

    it("classifies latency at threshold boundaries", () => {
      expect(latencyQuality(th.ping_great, th)).toBe("great");
      expect(latencyQuality(th.ping_great + 0.1, th)).toBe("ok");
      expect(latencyQuality(th.ping_good, th)).toBe("ok");
      expect(latencyQuality(th.ping_good + 0.1, th)).toBe("poor");
      expect(latencyQuality(th.ping_max, th)).toBe("poor");
      expect(latencyQuality(th.ping_max + 1, th)).toBe("poor");
    });

    it("classifies jitter at threshold boundaries", () => {
      expect(jitterQuality(th.jitter_great, th)).toBe("great");
      expect(jitterQuality(th.jitter_good, th)).toBe("ok");
      expect(jitterQuality(th.jitter_max, th)).toBe("poor");
      expect(jitterQuality(th.jitter_max + 1, th)).toBe("poor");
    });

    it("classifies loss at threshold boundaries", () => {
      expect(lossQuality(0, th)).toBe("great");
      expect(lossQuality(th.loss_good, th)).toBe("ok");
      expect(lossQuality(th.loss_good + 0.1, th)).toBe("poor");
      expect(lossQuality(th.loss_max - 0.1, th)).toBe("poor");
      expect(lossQuality(th.loss_max, th)).toBe("offline");
    });

    it("allows mixed quality across metrics", () => {
      expect(lossQuality(0, th)).toBe("great");
      expect(latencyQuality(35, th)).toBe("great");
      expect(jitterQuality(28, th)).toBe("poor");
    });
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

    it("scores spiky connections worse when P95 exceeds avg", () => {
      const base = {
        sample_count: 10,
        success_count: 10,
        loss_percent: 0,
        avg_latency_ms: 20,
        avg_jitter_ms: 3,
      };
      const avgOnly = connectionQualityPercent(base, th);
      const spiky = connectionQualityPercent({ ...base, p95_latency_ms: 150 }, th);
      expect(avgOnly).toBe(0);
      expect(spiky).toBe(69);
      expect(spiky).toBeGreaterThan(avgOnly);
    });

    it("falls back to avg when P95 is missing", () => {
      const summary = {
        sample_count: 10,
        success_count: 10,
        loss_percent: 0,
        avg_latency_ms: 60,
        avg_jitter_ms: 10,
      };
      expect(connectionQualityPercent(summary, th)).toBe(
        connectionQualityPercent({ ...summary, p95_latency_ms: 60 }, th),
      );
    });

    it("uses worst-of avg and P95 when both are elevated", () => {
      const avgOnly = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0,
          avg_latency_ms: 120,
          avg_jitter_ms: 3,
        },
        th,
      );
      const withHigherP95 = connectionQualityPercent(
        {
          sample_count: 10,
          success_count: 10,
          loss_percent: 0,
          avg_latency_ms: 120,
          p95_latency_ms: 150,
          avg_jitter_ms: 3,
        },
        th,
      );
      expect(withHigherP95).toBeGreaterThan(avgOnly);
      expect(avgOnly).toBe(50);
      expect(withHigherP95).toBe(69);
    });
  });
});
