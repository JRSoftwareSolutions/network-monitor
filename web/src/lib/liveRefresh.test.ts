import { describe, expect, it } from "vitest";
import { requestLiveRefresh, resetLiveRefresh, subscribeLiveRefresh } from "./liveRefresh";

describe("liveRefresh", () => {
  it("notifies subscribers", () => {
    resetLiveRefresh();
    let called = false;
    subscribeLiveRefresh(() => {
      called = true;
    });
    requestLiveRefresh();
    expect(called).toBe(true);
  });
});
