const { test, expect } = require("@playwright/test");

test("dashboard loads and shows connection status", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto("/");
  await expect(page.locator("#hero")).toBeVisible();
  await expect(page.locator("#status-panel")).toBeVisible();
  // Bootstrap runs poll(true); wait for metrics fetch to finish.
  await expect(page.locator("#status-text")).toHaveText(/Live|Waiting for data|Connection error/, {
    timeout: 10000,
  });
  await expect(page.locator("#status-text")).not.toHaveText("Connection error");

  expect(consoleErrors).toEqual([]);
});

test("settings popover opens and closes", async ({ page }) => {
  await page.goto("/");

  const toggle = page.locator("#settings-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();

  const popover = page.locator("#settings-popover");
  await expect(popover).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.locator("#settings-close").click();
  await expect(popover).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("window quality visualizations render in default view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-text")).toHaveText(/Live|Waiting for data/, { timeout: 10000 });

  await expect(page.locator("#quality-breakdown")).toBeVisible();
  await expect(page.locator("#quality-timeline")).toBeVisible();
  await expect(page.locator(".chart-legend")).toContainText("p95");
  await expect(page.locator(".chart-legend")).toContainText("baseline");
  await expect(page.locator("#export-metrics-btn")).toBeVisible();
  await expect(page.locator(".stat-sparkline").first()).toBeVisible();
});

test("analytics view shows visualization panels and hides live sections", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto("/");
  await expect(page.locator("#status-text")).toHaveText(/Live|Waiting for data/, { timeout: 10000 });

  const viewSelect = page.locator("#view-select");
  await expect(viewSelect).toBeVisible();
  await viewSelect.selectOption("analytics");

  await expect(page.locator("body")).toHaveAttribute("data-dashboard-view", "analytics");
  await expect(page.locator("#hero")).toBeHidden();
  await expect(page.locator('[data-panel="live"]')).toBeHidden();
  await expect(page.locator('[data-panel="stats"]')).toBeVisible();
  await expect(page.locator("#quality-composition-chart")).toBeVisible();
  await expect(page.locator("#spike-timeline-chart")).toBeVisible();
  await expect(page.locator("#latency-jitter-scatter-chart")).toBeVisible();
  await expect(page.locator("#latency-chart")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
