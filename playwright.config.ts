import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8080",
    headless: true,
  },
  webServer: {
    command: process.platform === "win32" ? "bin\\monitor.exe" : "./bin/monitor",
    url: "http://127.0.0.1:8080/api/health",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
