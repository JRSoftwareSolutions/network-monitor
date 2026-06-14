const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  webServer: {
    command: "python -m src.server",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
