import { test, expect } from "@playwright/test";

test("dashboard loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Network Monitor" })).toBeVisible();
  await expect(page.getByText("Connection")).toBeVisible();
});

test("settings can change target", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const input = page.getByLabel("Ping target");
  await input.fill("8.8.8.8");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("8.8.8.8")).toBeVisible();
});

test("live metrics update over time", async ({ page }) => {
  await page.goto("/");
  const liveCard = page.locator("section.card", {
    has: page.getByRole("heading", { name: "Live (60s)" }),
  });
  await expect(liveCard).toBeVisible();
  await expect(liveCard.getByText("Avg latency")).toBeVisible();
  await expect(liveCard.getByText("Avg jitter")).toBeVisible();
  await expect(liveCard.getByText("Packet loss")).toBeVisible();
  const pill = page.locator(".pill[data-state]");
  await expect(pill).toHaveAttribute("data-state", /online|stale/, { timeout: 8000 });
});

test("connection card shows avg and P95 latency", async ({ page }) => {
  await page.goto("/");
  const connectionCard = page.locator(".connection-status");
  await expect(connectionCard).toBeVisible();
  await expect(connectionCard.getByText("Avg latency")).toBeVisible();
  await expect(connectionCard.getByText("P95 latency")).toBeVisible();
  await expect(connectionCard.getByText("Packet loss")).toBeVisible();
});

test("metric quality indicators on connection and live cards", async ({ page }) => {
  await page.goto("/");
  const connectionCard = page.locator(".connection-status");
  const liveCard = page.locator("section.card", {
    has: page.getByRole("heading", { name: "Live (60s)" }),
  });
  const qualityPattern = /^(great|ok|poor|offline)$/;

  await expect(connectionCard.locator(".quality-indicated")).toHaveCount(3);
  await expect(liveCard.locator(".metric-tile.quality-indicated")).toHaveCount(3);

  await expect(connectionCard.locator(".quality-indicated").first()).toHaveAttribute(
    "data-quality",
    qualityPattern,
    { timeout: 8000 },
  );
  await expect(liveCard.locator(".metric-tile.quality-indicated").first()).toHaveAttribute(
    "data-quality",
    qualityPattern,
    { timeout: 8000 },
  );
});

test("window dropdown updates rolling scope labels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connection (30 min)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latency (30 min)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live (60s)" })).toBeVisible();

  await page.locator(".window-select select").selectOption("5");
  await expect(page.getByRole("heading", { name: "Connection (5 min)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latency (5 min)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live (60s)" })).toBeVisible();
});

test("window selection persists after refresh", async ({ page }) => {
  await page.goto("/");
  await page.locator(".window-select select").selectOption("5");
  await expect(page.getByRole("heading", { name: "Connection (5 min)" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connection (5 min)" })).toBeVisible();
});

test("window change keeps connection pill online", async ({ page }) => {
  await page.goto("/");
  const pill = page.locator(".pill[data-state]");
  await expect(pill).toHaveAttribute("data-state", /online|stale/, { timeout: 8000 });

  await page.locator(".window-select select").selectOption("60");
  await expect(page.getByRole("heading", { name: "Connection (60 min)" })).toBeVisible();
  await expect(pill).toHaveAttribute("data-state", /online|stale/);

  await page.locator(".window-select select").selectOption("180");
  await expect(page.getByRole("heading", { name: "Connection (180 min)" })).toBeVisible();
  await expect(pill).toHaveAttribute("data-state", /online|stale/);
});

test("latency chart container present after window change", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".chart-wrap")).toBeVisible();
  await page.locator(".window-select select").selectOption("5");
  await expect(page.locator(".chart-wrap")).toBeVisible();
});

test.describe("layout modes", () => {
  const ALIGN_TOLERANCE = 2;

  const connection = (page: import("@playwright/test").Page) => page.locator(".connection-status");
  const live = (page: import("@playwright/test").Page) =>
    page.locator("section.card", {
      has: page.getByRole("heading", { name: /Live \(60s\)/ }),
    });
  const chart = (page: import("@playwright/test").Page) => page.locator(".chart-span");

  function expectAligned(a: number, b: number) {
    expect(Math.abs(a - b)).toBeLessThanOrEqual(ALIGN_TOLERANCE);
  }

  test("vertical: cards stack above chart", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Network Monitor" })).toBeVisible();

    const connBox = await connection(page).boundingBox();
    const liveBox = await live(page).boundingBox();
    const chartBox = await chart(page).boundingBox();
    expect(connBox).not.toBeNull();
    expect(liveBox).not.toBeNull();
    expect(chartBox).not.toBeNull();
    expect(chartBox!.y).toBeGreaterThan(connBox!.y);
    expectAligned(connBox!.x, liveBox!.x);
    expectAligned(connBox!.x, chartBox!.x);
    expectAligned(connBox!.width, liveBox!.width);
    expectAligned(connBox!.width, chartBox!.width);
  });

  test("normal: connection and live side by side", async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Network Monitor" })).toBeVisible();

    const connBox = await connection(page).boundingBox();
    const liveBox = await live(page).boundingBox();
    const chartBox = await chart(page).boundingBox();
    expect(connBox).not.toBeNull();
    expect(liveBox).not.toBeNull();
    expect(chartBox).not.toBeNull();
    expectAligned(connBox!.y, liveBox!.y);
    expect(connBox!.x).toBeLessThan(liveBox!.x);
    const colGap = liveBox!.x - (connBox!.x + connBox!.width);
    expect(colGap).toBeGreaterThan(0);
    expect(colGap).toBeLessThan(20);
    expectAligned(chartBox!.x, connBox!.x);
    expect(chartBox!.y).toBeGreaterThan(connBox!.y);
  });

  test("ultrawide: chart beside connection cards", async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1080 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Network Monitor" })).toBeVisible();

    const connBox = await connection(page).boundingBox();
    const liveBox = await live(page).boundingBox();
    const chartBox = await chart(page).boundingBox();
    expect(connBox).not.toBeNull();
    expect(liveBox).not.toBeNull();
    expect(chartBox).not.toBeNull();
    expect(chartBox!.x).toBeGreaterThan(connBox!.x);
    expectAligned(connBox!.y, chartBox!.y);
    expectAligned(liveBox!.y + liveBox!.height, chartBox!.y + chartBox!.height);
    const rowGap = liveBox!.y - (connBox!.y + connBox!.height);
    expect(rowGap).toBeGreaterThan(0);
    expect(rowGap).toBeLessThan(20);
    expectAligned(connBox!.x, liveBox!.x);
    expectAligned(connBox!.width, liveBox!.width);
  });

  test("ultrawide: layout stable when window height changes", async ({ page }) => {
    for (const height of [700, 1200]) {
      await page.setViewportSize({ width: 1600, height });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Network Monitor" })).toBeVisible();

      const connBox = await connection(page).boundingBox();
      const chartBox = await chart(page).boundingBox();
      expect(connBox).not.toBeNull();
      expect(chartBox).not.toBeNull();
      expect(chartBox!.x).toBeGreaterThan(connBox!.x);
    }
  });

  test("normal: chart full width below cards at typical desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Network Monitor" })).toBeVisible();

    const connBox = await connection(page).boundingBox();
    const liveBox = await live(page).boundingBox();
    const chartBox = await chart(page).boundingBox();
    expect(connBox).not.toBeNull();
    expect(liveBox).not.toBeNull();
    expect(chartBox).not.toBeNull();
    expect(chartBox!.y).toBeGreaterThan(connBox!.y);
    expectAligned(chartBox!.x, connBox!.x);
    expectAligned(chartBox!.x + chartBox!.width, liveBox!.x + liveBox!.width);
  });

  test("vertical: live metric detail stats visible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const liveCard = live(page);
    await expect(liveCard.locator(".metric-detail").first()).toBeVisible();
    await expect(liveCard.getByText("Lost", { exact: true })).toBeVisible();
  });

  test("normal: live metric detail stats hidden", async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 800 });
    await page.goto("/");
    const liveCard = live(page);
    await expect(liveCard.locator(".metric-detail").first()).toBeHidden();
    await expect(liveCard.getByText("Lost", { exact: true })).toBeHidden();
  });
});
