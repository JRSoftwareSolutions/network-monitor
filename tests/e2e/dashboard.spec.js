const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const FIXTURES_DIR = path.join(__dirname, "fixtures");

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
  expect(Math.abs(heights.status - heights.hero)).toBeLessThanOrEqual(1);

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
  expect(heights.jitterCard).toBeGreaterThan(heights.statusCard * 0.5);
  expect(Math.abs(heights.statusPanel - heights.jitterCard)).toBeLessThanOrEqual(2);
  expect(Math.abs(heights.statusCard - heights.jitterCard)).toBeLessThanOrEqual(2);
});

test("indicators show four metric tiles", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator("#ind-ping")).toBeVisible();
  await expect(page.locator(".indicators .indicator")).toHaveCount(4);
});

test("indicators panel height stays stable across live polls", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);

  const panel = page.locator('.dashboard-panel[data-panel="indicators"]');
  await expect(panel).toBeVisible();

  const initialHeight = await panel.evaluate((el) => el.getBoundingClientRect().height);
  await expect.poll(async () => {
    return panel.evaluate((el) => el.getBoundingClientRect().height);
  }).toBe(initialHeight);
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
  await expect(page.locator("#blocks-plot")).toBeVisible();
  await expect(page.locator("#latency-chart")).toBeVisible();
  await expect(page.locator("#health-chip")).toBeVisible();
});

function sampleAt(endIso, offsetMinutes, latency, jitter) {
  const end = new Date(endIso);
  const ts = new Date(end.getTime() - offsetMinutes * 60 * 1000).toISOString();
  return {
    ts,
    host: "1.1.1.1",
    success: true,
    latency_ms: latency,
    jitter_ms: jitter,
  };
}

function blocksForWindow(windowMinutes) {
  const end = new Date("2026-01-01T12:05:00.000Z");
  const buckets = [];
  for (let i = 0; i < windowMinutes; i++) {
    const start = new Date(end.getTime() - (windowMinutes - 1 - i) * 60 * 1000);
    buckets.push({
      ts_start: start.toISOString(),
      ts_end: new Date(start.getTime() + 60 * 1000).toISOString(),
      quality: "good",
      sample_count: i >= windowMinutes - 3 ? 1 : 0,
      failed_count: 0,
      loss_pct: 0,
      avg_ms: i >= windowMinutes - 3 ? 22 : null,
      jitter_avg_ms: i >= windowMinutes - 3 ? 1.2 : null,
    });
  }
  return buckets;
}

function metricsForWindow(windowMinutes) {
  const end = "2026-01-01T12:05:00.000Z";
  const recent = [
    sampleAt(end, 1, 22, 1.2),
    sampleAt(end, 0.5, 24, 1.5),
    sampleAt(end, 0, 21, 1.1),
  ];
  const older = [];
  if (windowMinutes >= 30) {
    for (let m = 16; m <= 28; m += 2) {
      older.push(sampleAt(end, m, 25 + (m % 3), null));
    }
  } else if (windowMinutes >= 5) {
    for (let m = 4; m >= 1; m -= 1) {
      older.push(sampleAt(end, m, 23 + m, 1 + m * 0.1));
    }
  }
  const samples = older.concat(recent);
  const base = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, "metrics-full.json"), "utf8"),
  );
  return {
    ...base,
    window_minutes: windowMinutes,
    samples,
    recent_samples: recent,
    sample_count_raw: samples.length,
    latency_distribution: {
      great: samples.filter((s) => s.success && s.latency_ms < 40).length,
      good: 0,
      okay: 0,
      bad: 0,
      failed: samples.filter((s) => !s.success).length,
    },
    blocks: {
      window_minutes: windowMinutes,
      bucket_seconds: 60,
      buckets: blocksForWindow(windowMinutes),
    },
  };
}

function lineChartRangeMs(page, chartId) {
  return page.evaluate((id) => {
    const canvas = document.getElementById(id);
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    if (!chart) return 0;
    return chart.scales.x.max - chart.scales.x.min;
  }, chartId);
}

function jitterChartRangeMs(page) {
  return lineChartRangeMs(page, "jitter-chart");
}

function latencyChartRangeMs(page) {
  return lineChartRangeMs(page, "latency-chart");
}

async function stubWindowedMetrics(page) {
  await page.route("**/api/metrics?**", async (route) => {
    const url = new URL(route.request().url());
    const windowMinutes = Number(url.searchParams.get("windowMinutes") || "15");
    await route.fulfill({
      contentType: "application/json",
      json: metricsForWindow(windowMinutes),
    });
  });
  await page.route("**/api/metrics/live**", async (route) => {
    const live = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    await route.fulfill({ contentType: "application/json", json: live });
  });
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        target: "1.1.1.1",
        default_window_minutes: 15,
        window_options: [15, 30],
        ping_interval_seconds: 1,
        max_log_age_minutes: 180,
        full_refresh_seconds: 60,
        connection_refresh_seconds: 120,
      },
    });
  });
}

test("latency chart rescales when time window changes", async ({ page }) => {
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  const rangeAt15 = await latencyChartRangeMs(page);
  expect(rangeAt15).toBeCloseTo(15 * 60 * 1000, -3);

  await page.selectOption("#window-select", "30");
  await expect.poll(async () => latencyChartRangeMs(page)).toBeCloseTo(30 * 60 * 1000, -3);
});

test("jitter chart rescales when time window changes", async ({ page }) => {
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  const rangeAt15 = await jitterChartRangeMs(page);
  expect(rangeAt15).toBeCloseTo(15 * 60 * 1000, -3);

  await page.selectOption("#window-select", "30");
  await expect.poll(async () => jitterChartRangeMs(page)).toBeCloseTo(30 * 60 * 1000, -3);
});

test("jitter chart keeps updating after window change 5 to 15", async ({ page }) => {
  let liveCall = 0;
  const baseEndMs = Date.parse("2026-01-01T12:05:00.000Z");

  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        target: "1.1.1.1",
        default_window_minutes: 5,
        window_options: [5, 15, 30],
        ping_interval_seconds: 1,
        max_log_age_minutes: 180,
        full_refresh_seconds: 60,
        connection_refresh_seconds: 120,
      },
    });
  });
  await page.route("**/api/metrics?**", async (route) => {
    const url = new URL(route.request().url());
    const windowMinutes = Number(url.searchParams.get("windowMinutes") || "5");
    await route.fulfill({
      contentType: "application/json",
      json: metricsForWindow(windowMinutes),
    });
  });
  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const endMs = baseEndMs + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      jitter_ms: (s.jitter_ms ?? 1) + liveCall,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });

  await page.goto("/");
  await waitForLiveStatus(page);
  await page.selectOption("#window-select", "15");
  await expect.poll(async () => jitterChartRangeMs(page)).toBeCloseTo(15 * 60 * 1000, -3);

  const maxAfterChange = await page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  expect(maxAfterChange).toBeGreaterThan(0);

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(maxAfterChange);
});

test("jitter chart keeps updating after window change 15 to 5", async ({ page }) => {
  let liveCall = 0;
  const baseEndMs = Date.parse("2026-01-01T12:05:00.000Z");

  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        target: "1.1.1.1",
        default_window_minutes: 15,
        window_options: [5, 15, 30],
        ping_interval_seconds: 1,
        max_log_age_minutes: 180,
        full_refresh_seconds: 60,
        connection_refresh_seconds: 120,
      },
    });
  });
  await page.route("**/api/metrics?**", async (route) => {
    const url = new URL(route.request().url());
    const windowMinutes = Number(url.searchParams.get("windowMinutes") || "15");
    await route.fulfill({
      contentType: "application/json",
      json: metricsForWindow(windowMinutes),
    });
  });
  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const endMs = baseEndMs + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      jitter_ms: (s.jitter_ms ?? 1) + liveCall,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });

  await page.goto("/");
  await waitForLiveStatus(page);
  await page.selectOption("#window-select", "5");
  await expect.poll(async () => jitterChartRangeMs(page)).toBeCloseTo(5 * 60 * 1000, -3);

  const maxAfterChange = await page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  expect(maxAfterChange).toBeGreaterThan(0);

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(maxAfterChange);
});

test("loss chart bucket count matches time window", async ({ page }) => {
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  const countAt15 = await page.evaluate(() => {
    const canvas = document.getElementById("loss-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.data?.labels?.length ?? 0;
  });
  expect(countAt15).toBe(15);

  await page.selectOption("#window-select", "30");
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("loss-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.data?.labels?.length ?? 0;
  })).toBe(30);
});

test("quality timeline cell count matches time window", async ({ page }) => {
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  await expect(page.locator("#quality-timeline .tl-cell")).toHaveCount(15);

  await page.selectOption("#window-select", "30");
  await expect(page.locator("#quality-timeline .tl-cell")).toHaveCount(30);
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

test("charts resize when panel width changes in layout mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);
  await expect(page.locator("#distribution-chart")).toBeVisible();

  await page.locator("#layout-toggle").click();
  await page.locator('[data-panel="distribution"]').click();
  await page.locator('.layout-width-btn[data-width="6"]').click();

  await page.locator('.layout-width-btn[data-width="4"]').click();

  await expect.poll(async () => page.evaluate(() => {
    const wrap = document.querySelector('[data-panel="distribution"] .chart-wrap');
    const canvas = document.getElementById("distribution-chart");
    if (!wrap || !canvas) return Infinity;
    return Math.abs(wrap.getBoundingClientRect().width - canvas.getBoundingClientRect().width);
  })).toBeLessThan(4);

  await page.locator("#layout-exit-edit").click();
});

test("quality timeline chart resizes when panel width grows in layout mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);
  await expect(page.locator("#blocks-plot")).toBeVisible();

  await page.locator("#layout-toggle").click();
  await page.locator('[data-panel="quality-timeline"]').click();
  await page.locator('.layout-width-btn[data-width="6"]').click();
  const widthAt6 = await page.evaluate(() => document.getElementById("blocks-plot")?.getBoundingClientRect().width ?? 0);

  await page.locator('.layout-width-btn[data-width="8"]').click();

  await expect.poll(async () => page.evaluate((prev) => {
    const panel = document.querySelector('[data-panel="quality-timeline"]');
    const timeline = document.getElementById("quality-timeline");
    const chart = document.getElementById("blocks-chart");
    const plot = document.getElementById("blocks-plot");
    if (!panel || !timeline || !chart || !plot) return 0;
    const panelInner = panel.clientWidth - 40;
    const timelineGap = Math.abs(timeline.getBoundingClientRect().width - panelInner);
    const chartGap = Math.abs(chart.getBoundingClientRect().width - panelInner);
    const plotWidth = plot.getBoundingClientRect().width;
    if (timelineGap > 8 || chartGap > 8) return 0;
    if (plotWidth <= prev + 40) return 0;
    return plotWidth;
  }, widthAt6), { timeout: 2000 }).toBeGreaterThan(widthAt6 + 40);

  await page.locator("#layout-exit-edit").click();
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

test("panel hide button hides panel in edit mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await waitForLiveStatus(page);

  await page.locator("#layout-toggle").click();
  const heroPanel = page.locator('[data-panel="hero"]');
  await expect(heroPanel.locator(".layout-panel-hide-btn")).toBeVisible();

  await heroPanel.locator(".layout-panel-hide-btn").click();
  await expect(heroPanel).toHaveClass(/is-panel-hidden/);

  await page.locator("#layout-exit-edit").click();
  await expect(heroPanel).toHaveClass(/is-panel-hidden/);
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

test("forced full refresh runs after aborting in-flight poll", async ({ page }) => {
  let metricsCalls = 0;
  let slowNext = false;
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        target: "1.1.1.1",
        default_window_minutes: 15,
        window_options: [15, 30],
        ping_interval_seconds: 1,
        max_log_age_minutes: 180,
        full_refresh_seconds: 60,
        connection_refresh_seconds: 120,
      },
    });
  });
  await page.route("**/api/metrics/live**", async (route) => {
    const live = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    await route.fulfill({ contentType: "application/json", json: live });
  });
  await page.route("**/api/metrics?**", async (route) => {
    metricsCalls += 1;
    if (slowNext) {
      slowNext = false;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const url = new URL(route.request().url());
    const windowMinutes = Number(url.searchParams.get("windowMinutes") || "15");
    await route.fulfill({
      contentType: "application/json",
      json: metricsForWindow(windowMinutes),
    });
  });

  await page.goto("/");
  await waitForLiveStatus(page);

  slowNext = true;
  await page.selectOption("#window-select", "30");

  await expect.poll(() => metricsCalls, { timeout: 12000 }).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => latencyChartRangeMs(page)).toBeCloseTo(30 * 60 * 1000, -3);
});

test("unchanged live poll still updates staleness pill", async ({ page }) => {
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  await page.evaluate(() => {
    document.getElementById("updated-pill").textContent = "10s ago";
  });

  await page.route("**/api/metrics/live**", async (route) => {
    const live = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    await route.fulfill({
      contentType: "application/json",
      json: { unchanged: true, latest_ts: live.latest_ts, now: live.now },
    });
  });

  await expect.poll(async () => page.locator("#updated-pill").textContent()).toMatch(/just now|1s ago|2s ago/);
});

test("live poll advances line charts between full refreshes", async ({ page }) => {
  let liveCall = 0;
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  const maxBefore = await page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  expect(maxBefore).toBeGreaterThan(0);

  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    const endMs = Date.parse("2026-01-01T12:05:00.000Z") + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      jitter_ms: (s.jitter_ms ?? 1) + liveCall,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(maxBefore);
});

test("live poll advances latency chart between full refreshes", async ({ page }) => {
  let liveCall = 0;
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  const maxBefore = await page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  expect(maxBefore).toBeGreaterThan(0);

  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    const endMs = Date.parse("2026-01-01T12:05:00.000Z") + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      latency_ms: (s.latency_ms ?? 20) + liveCall,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(maxBefore);
});

test("latency chart keeps updating after window change 5 to 15", async ({ page }) => {
  let liveCall = 0;
  const baseEndMs = Date.parse("2026-01-01T12:05:00.000Z");

  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        target: "1.1.1.1",
        default_window_minutes: 5,
        window_options: [5, 15, 30],
        ping_interval_seconds: 1,
        max_log_age_minutes: 180,
        full_refresh_seconds: 60,
        connection_refresh_seconds: 120,
      },
    });
  });
  await page.route("**/api/metrics?**", async (route) => {
    const url = new URL(route.request().url());
    const windowMinutes = Number(url.searchParams.get("windowMinutes") || "5");
    await route.fulfill({
      contentType: "application/json",
      json: metricsForWindow(windowMinutes),
    });
  });
  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const endMs = baseEndMs + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      latency_ms: (s.latency_ms ?? 20) + liveCall,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });

  await page.goto("/");
  await waitForLiveStatus(page);
  await page.selectOption("#window-select", "15");
  await expect.poll(async () => latencyChartRangeMs(page)).toBeCloseTo(15 * 60 * 1000, -3);

  const maxAfterChange = await page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  expect(maxAfterChange).toBeGreaterThan(0);

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(maxAfterChange);
});

test("poll recovery catches up after stalled live responses", async ({ page }) => {
  let liveCalls = 0;
  let failLive = false;
  await stubWindowedMetrics(page);

  await page.route("**/api/metrics/live**", async (route) => {
    liveCalls += 1;
    if (failLive) {
      await route.abort();
      return;
    }
    const live = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    await route.fulfill({ contentType: "application/json", json: live });
  });

  await page.goto("/");
  await waitForLiveStatus(page);
  const callsBeforeStall = liveCalls;

  failLive = true;
  await page.waitForTimeout(4500);
  failLive = false;

  await expect.poll(() => liveCalls, { timeout: 10000 }).toBeGreaterThan(callsBeforeStall + 1);
});

test("charts keep rolling after stalled live polls", async ({ page }) => {
  let liveCall = 0;
  const baseEndMs = Date.parse("2026-01-01T12:05:00.000Z");
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  const latencyMaxBefore = await page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  expect(latencyMaxBefore).toBeGreaterThan(0);

  await page.route("**/api/metrics/live**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { unchanged: true, latest_ts: new Date(baseEndMs).toISOString(), now: {} },
    });
  });
  await page.waitForTimeout(3500);

  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const endMs = baseEndMs + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      latency_ms: (s.latency_ms ?? 20) + liveCall,
      jitter_ms: (s.jitter_ms ?? 1) + liveCall * 0.1,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(latencyMaxBefore);
});

test("charts keep rolling after tab becomes visible", async ({ page }) => {
  let liveCall = 0;
  const baseEndMs = Date.parse("2026-01-01T12:05:00.000Z");
  await stubWindowedMetrics(page);
  await page.goto("/");
  await waitForLiveStatus(page);

  const latencyMaxBefore = await page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  const jitterMaxBefore = await page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  });
  expect(latencyMaxBefore).toBeGreaterThan(0);
  expect(jitterMaxBefore).toBeGreaterThan(0);

  await page.route("**/api/metrics/live**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { unchanged: true, latest_ts: new Date(baseEndMs).toISOString(), now: {} },
    });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("blur"));
  });
  await page.waitForTimeout(3100);

  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const endMs = baseEndMs + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      latency_ms: (s.latency_ms ?? 20) + liveCall,
      jitter_ms: (s.jitter_ms ?? 1) + liveCall * 0.1,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(latencyMaxBefore);
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("jitter-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.scales?.x?.max ?? 0;
  }), { timeout: 8000 }).toBeGreaterThan(jitterMaxBefore);
});

test("settings save triggers full metrics fetch", async ({ page }) => {
  let metricsCalls = 0;
  let liveCall = 0;
  const baseEndMs = Date.parse("2026-01-01T12:05:00.000Z");
  await page.route("**/api/config", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          target: "8.8.8.8",
          default_window_minutes: 15,
          window_options: [15, 30],
          ping_interval_seconds: 1,
          max_log_age_minutes: 180,
          full_refresh_seconds: 60,
          connection_refresh_seconds: 120,
        },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        target: "1.1.1.1",
        default_window_minutes: 15,
        window_options: [15, 30],
        ping_interval_seconds: 1,
        max_log_age_minutes: 180,
        full_refresh_seconds: 60,
        connection_refresh_seconds: 120,
      },
    });
  });
  await page.route("**/api/metrics/live**", async (route) => {
    liveCall += 1;
    const endMs = baseEndMs + liveCall * 15 * 1000;
    const end = new Date(endMs).toISOString();
    const base = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );
    base.latest_ts = end;
    base.recent_samples = base.recent_samples.map((s, i) => ({
      ...s,
      ts: new Date(endMs - (base.recent_samples.length - 1 - i) * 30 * 1000).toISOString(),
      latency_ms: (s.latency_ms ?? 20) + liveCall,
    }));
    await route.fulfill({ contentType: "application/json", json: base });
  });
  await page.route("**/api/metrics?**", async (route) => {
    metricsCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const url = new URL(route.request().url());
    const windowMinutes = Number(url.searchParams.get("windowMinutes") || "15");
    const payload = metricsForWindow(windowMinutes);
    payload.latest_ts = new Date(baseEndMs + metricsCalls * 15 * 1000).toISOString();
    if (metricsCalls > 1) payload.now = { ...(payload.now || {}), baseline_ms: 99 };
    await route.fulfill({ contentType: "application/json", json: payload });
  });

  await page.goto("/");
  await waitForLiveStatus(page);
  const callsBeforeSave = metricsCalls;

  await page.locator("#settings-btn").click();
  await page.selectOption("#set-target-preset", "8.8.8.8");
  await page.locator("#settings-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#settings-modal")).toBeHidden({ timeout: 5000 });

  await expect.poll(() => metricsCalls, { timeout: 8000 }).toBeGreaterThan(callsBeforeSave);
  await expect(page.locator("#target-label")).toHaveText("8.8.8.8");
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById("latency-chart");
    const chart = canvas && window.Chart ? window.Chart.getChart(canvas) : null;
    return chart?.data?.datasets?.[0]?.data?.length ?? 0;
  })).toBeGreaterThan(0);
});

test.describe("visual regression", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test.beforeEach(async ({ page }) => {
    const metricsFull = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-full.json"), "utf8"),
    );
    const metricsLive = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "metrics-live.json"), "utf8"),
    );

    await page.route("**/api/metrics/live**", async (route) => {
      await route.fulfill({ contentType: "application/json", json: metricsLive });
    });
    await page.route("**/api/metrics?**", async (route) => {
      await route.fulfill({ contentType: "application/json", json: metricsFull });
    });
  });

  test("default dashboard view", async ({ page }) => {
    await page.goto("/");
    await waitForLiveStatus(page);
    await expect(page.locator("#dashboard-grid")).toHaveScreenshot("default-view.png", {
      maxDiffPixelRatio: 0.05,
    });
  });
});
