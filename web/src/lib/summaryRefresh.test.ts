import { describe, expect, it } from "vitest";
import { requestSummaryRefresh, resetSummaryRefresh, subscribeSummaryRefresh } from "./summaryRefresh";

describe("summaryRefresh", () => {
  it("notifies subscribers with window minutes", () => {
    resetSummaryRefresh();
    let minutes = 0;
    subscribeSummaryRefresh((m) => {
      minutes = m;
    });
    requestSummaryRefresh(30);
    expect(minutes).toBe(30);
  });
});
