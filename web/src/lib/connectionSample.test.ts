import { describe, expect, it } from "vitest";
import {
  adoptConnectionSample,
  readConnectionSample,
  resetConnectionSample,
  subscribeConnectionSample,
} from "./connectionSample";

describe("connectionSample", () => {
  it("stores the latest sample by timestamp", () => {
    resetConnectionSample();
    adoptConnectionSample("2026-06-16T12:00:01.000Z", true);
    adoptConnectionSample("2026-06-16T12:00:02.000Z", false);
    expect(readConnectionSample()).toEqual({
      lastTs: "2026-06-16T12:00:02.000Z",
      lastSuccess: false,
    });
  });

  it("ignores out-of-order samples", () => {
    resetConnectionSample();
    adoptConnectionSample("2026-06-16T12:00:02.000Z", true);
    adoptConnectionSample("2026-06-16T12:00:01.000Z", false);
    expect(readConnectionSample()).toEqual({
      lastTs: "2026-06-16T12:00:02.000Z",
      lastSuccess: true,
    });
  });

  it("notifies subscribers on adopt", () => {
    resetConnectionSample();
    let count = 0;
    const unsub = subscribeConnectionSample(() => {
      count++;
    });
    adoptConnectionSample("2026-06-16T12:00:01.000Z", true);
    expect(count).toBe(1);
    unsub();
  });
});
