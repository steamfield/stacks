import { defineConfig, devices } from "@playwright/test";
import { game } from "./src/game.ts";
import { CHROMIUM_ARGS } from "./tests/support/chromium-args.ts";
import { freePort } from "./tests/support/ports.ts";

// PORT_E2E pins the port; otherwise one free port is chosen and handed to the workers through the
// environment, since each worker loads this file again.
process.env.PORT_E2E ??= String(await freePort());
const baseURL = `http://127.0.0.1:${process.env.PORT_E2E}`;
const launchOptions = { args: [...CHROMIUM_ARGS] };
// Phones are held the way the game wants; otherwise the shell's rotate prompt covers the game.
const phone = game.orientation === "landscape" ? devices["Pixel 7 landscape"] : devices["Pixel 7"];

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // One retry on CI, and a test that passes only on it still fails the run: a flaky test is a
  // determinism bug to fix, and the retry's report says whether the failure repeats.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: "line",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      // Tests tagged @touch need a touch device; they run in the mobile project.
      grepInvert: /@touch/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      // No WebKit project: headless WebGL there isn't reliable enough for a 3D smoke test.
      name: "mobile",
      testMatch: "**/smoke.spec.ts",
      use: { ...phone, launchOptions },
    },
  ],
  webServer: {
    // `bun run e2e` builds first; this serves dist/ the way a static host would.
    command: `bun run preview --host 127.0.0.1 --port ${process.env.PORT_E2E} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
