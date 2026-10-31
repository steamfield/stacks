import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT_E2E ?? 4180);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    // `bun run e2e` builds first; this serves dist/ the way a static host would.
    command: `bun run preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
