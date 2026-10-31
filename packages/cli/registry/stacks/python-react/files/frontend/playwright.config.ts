import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const cwd = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:15173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "make dev-api PORT_API=18000",
      url: "http://127.0.0.1:18000/health",
      cwd,
      reuseExistingServer: false,
    },
    {
      command: "make dev-web PORT_WEB=15173 PORT_API=18000",
      url: "http://127.0.0.1:15173",
      cwd,
      reuseExistingServer: false,
    },
  ],
});
