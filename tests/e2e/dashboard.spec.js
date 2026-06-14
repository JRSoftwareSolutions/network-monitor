const { test, expect } = require("@playwright/test");

async function waitForLiveStatus(page) {
  await expect(page.locator("#status-text")).toHaveText(/Live|Waiting for data|Connecting/, {
    timeout: 10000,
  });
}

test("dashboard loads and shows connection status", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto("/");
  await expect(page.locator(".hero")).toBeVisible();
  await expect(page.locator("#status-pill")).toBeVisible();
  await waitForLiveStatus(page);
  await expect(page.locator("#status-text")).not.toHaveText("Connection error");

  expect(consoleErrors).toEqual([]);
});

test("indicators show four metric tiles", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator("#ind-ping")).toBeVisible();
  await expect(page.locator(".indicators .indicator")).toHaveCount(4);
});

test("settings modal opens and closes", async ({ page }) => {
  await page.goto("/");

  await page.locator("#settings-btn").click();
  await expect(page.locator("#settings-modal")).toBeVisible();

  await page.locator("#settings-close").click();
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("window selector and charts render", async ({ page }) => {
  await page.goto("/");
  await waitForLiveStatus(page);

  await expect(page.locator("#window-select")).toBeVisible();
  await expect(page.locator("#quality-timeline")).toBeVisible();
  await expect(page.locator("#latency-chart")).toBeVisible();
  await expect(page.locator("#health-chip")).toBeVisible();
});

test("view selector and layout dialog", async ({ page }) => {
  await page.goto("/");
  await waitForLiveStatus(page);

  await expect(page.locator("#view-select")).toBeVisible();
  await expect(page.locator("#view-select option")).toHaveCount(2);

  await page.locator("#layout-toggle").click();
  await expect(page.locator("#layout-dialog")).toBeVisible();
  await expect(page.locator("#layout-panel-groups")).toBeVisible();

  await page.locator("#layout-dialog-close").click();
  await expect(page.locator("#layout-dialog")).toBeHidden();
});

test("customize grid enables edit mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);

  await page.locator("#layout-toggle").click();
  await page.locator("#layout-customize-grid").click();
  await expect(page.locator("body")).toHaveAttribute("data-layout-edit", "true");
  await expect(page.locator("#layout-edit-bar")).toBeVisible();

  await page.locator("#layout-exit-edit").click();
  await expect(page.locator("body")).not.toHaveAttribute("data-layout-edit", "true");
});

test("analytics view hides live panels", async ({ page }) => {
  await page.goto("/");
  await waitForLiveStatus(page);

  await page.selectOption("#view-select", "analytics");
  await expect(page.locator('[data-panel="hero"]')).toHaveClass(/is-panel-hidden/);
  await expect(page.locator('[data-panel="latency"]')).not.toHaveClass(/is-panel-hidden/);
});

test.describe("visual regression", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test("default dashboard view", async ({ page }) => {
    await page.goto("/");
    await waitForLiveStatus(page);
    await page.waitForTimeout(750);
    await expect(page.locator("#dashboard-grid")).toHaveScreenshot("default-view.png", {
      maxDiffPixelRatio: 0.05,
    });
  });
});
