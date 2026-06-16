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
  await expect(page.getByText("Live (60s)")).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.locator(".pill[data-state='online'], .pill[data-state='stale']")).toBeVisible();
});
