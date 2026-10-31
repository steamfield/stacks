import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: "http://127.0.0.1:5180", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "bun run start",
    url: "http://127.0.0.1:5180/healthz",
    reuseExistingServer: false,
    env: { NODE_ENV: "production", PORT_WEB: "5180", GREETING: "Hello", LOG_LEVEL: "info" },
  },
});
