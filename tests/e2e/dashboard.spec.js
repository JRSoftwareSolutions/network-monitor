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

test("status panel matches hero height with long content", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);

  await page.evaluate(() => {
    document.getElementById("status-headline").textContent =
      "Very long unstable headline that should wrap to two lines easily";
    for (const id of ["sm-ping-note", "sm-jitter-note", "sm-loss-note", "sm-spikes-note"]) {
      document.getElementById(id).textContent =
        "This is an extremely long note that should truncate with ellipsis when space runs out";
    }
  });

  const heights = await page.evaluate(() => {
    const hero = document.querySelector('[data-panel="hero"] > .card');
    const status = document.querySelector('[data-panel="status"] > .card');
    return {
      hero: hero?.getBoundingClientRect().height ?? 0,
      status: status?.getBoundingClientRect().height ?? 0,
    };
  });

  expect(heights.hero).toBeGreaterThan(0);
  expect(heights.status).toBe(heights.hero);
  expect(heights.status).toBeCloseTo(240, 0);

  const fill = await page.evaluate(() => {
    const card = document.querySelector('[data-panel="status"] > .card');
    const metrics = card?.querySelector(".status-metrics");
    if (!card || !metrics) return { gap: Infinity };
    const cardStyle = getComputedStyle(card);
    const cardRect = card.getBoundingClientRect();
    const metricsRect = metrics.getBoundingClientRect();
    const padBottom = parseFloat(cardStyle.paddingBottom);
    const gapBelowMetrics = cardRect.bottom - padBottom - metricsRect.bottom;
    const rows = [...metrics.querySelectorAll(".status-row")].map((r) => r.getBoundingClientRect().height);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    return { gapBelowMetrics, minRow, maxRow };
  });

  expect(fill.gapBelowMetrics).toBeLessThan(2);
  expect(fill.maxRow - fill.minRow).toBeLessThan(2);
});

test("status panel stretches to match chart row height", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);

  const heights = await page.evaluate(() => {
    const statusPanel = document.querySelector('[data-panel="status"]');
    const jitterPanel = document.querySelector('[data-panel="jitter"]');
    const lossPanel = document.querySelector('[data-panel="loss"]');
    if (!statusPanel || !jitterPanel || !lossPanel) return null;

    // Place status on the jitter/loss row (custom layouts often do this).
    statusPanel.style.order = jitterPanel.style.order || "8";
    statusPanel.classList.remove("span-4", "span-3", "span-8", "span-12");
    statusPanel.classList.add("span-6");
    lossPanel.classList.add("is-panel-hidden");

    const jitterCard = jitterPanel.querySelector(".card");
    const statusPanelRect = statusPanel.getBoundingClientRect();
    const statusCardRect = statusPanel.querySelector(".card")?.getBoundingClientRect();
    const jitterCardRect = jitterCard?.getBoundingClientRect();
    return {
      jitterCard: jitterCardRect?.height ?? 0,
      statusPanel: statusPanelRect.height,
      statusCard: statusCardRect?.height ?? 0,
    };
  });

  expect(heights).not.toBeNull();
  expect(heights.jitterCard).toBeGreaterThan(300);
  expect(heights.statusPanel).toBeCloseTo(heights.jitterCard, 0);
  expect(heights.statusCard).toBeCloseTo(heights.jitterCard, 0);
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

test("view selector and layout edit mode", async ({ page }) => {
  await page.goto("/");
  await waitForLiveStatus(page);

  await expect(page.locator("#view-select")).toBeVisible();
  await expect(page.locator("#view-select option")).toHaveCount(2);
  await expect(page.locator('#view-select option[value="__new_view__"]')).toHaveText("+ New view...");

  await page.locator("#layout-toggle").click();
  await expect(page.locator("body")).toHaveAttribute("data-layout-edit", "true");
  await expect(page.locator("#layout-edit-bar")).toBeVisible();

  await page.locator("#layout-exit-edit").click();
  await expect(page.locator("body")).not.toHaveAttribute("data-layout-edit", "true");
});

test("new view modal creates a custom view", async ({ page }) => {
  await page.goto("/");
  await waitForLiveStatus(page);

  await page.selectOption("#view-select", "__new_view__");
  await expect(page.locator("#new-view-modal")).toBeVisible();

  await page.locator("#new-view-name").fill("Test view");
  await page.locator("#new-view-form").evaluate((form) => form.requestSubmit());

  await expect(page.locator("#new-view-modal")).toBeHidden();
  await expect(page.locator("#view-select")).toHaveValue(/test-view/);
  await expect(page.locator("#view-delete-btn")).toBeVisible();
});

test("panels popover toggles panel visibility in edit mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);

  await page.locator("#layout-toggle").click();
  await page.locator("#layout-panels-toggle").click();
  await expect(page.locator("#layout-panels-popover")).toBeVisible();
  await expect(page.locator("#layout-panel-groups")).toBeVisible();

  await page.locator('#layout-panel-groups input[data-panel-id="hero"]').uncheck();
  await expect(page.locator('[data-panel="hero"]')).toHaveClass(/is-panel-hidden/);

  await page.locator("#layout-exit-edit").click();
  await expect(page.locator('[data-panel="hero"]')).toHaveClass(/is-panel-hidden/);
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
