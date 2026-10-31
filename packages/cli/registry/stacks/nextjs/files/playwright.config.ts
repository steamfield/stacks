import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT_E2E ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: `bun run start --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    env: { NODE_ENV: "production", APP_TITLE: "Items" },
  },
});
