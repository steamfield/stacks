/**
 * Playwright runs against the production build served by `vite preview` on PORT_E2E. Three browser
 * projects: desktop Chromium runs everything, and a phone plus WebKit run the smoke tests, which
 * pin one world hash so all three must agree on the game's logic.
 */
import { defineConfig, devices } from "@playwright/test";
import { GAME } from "./src/game.ts";
import { CHROMIUM_ARGS } from "./tests/support/chromium-args.ts";

const port = Number(process.env.PORT_E2E ?? 4180);
const baseURL = `http://127.0.0.1:${port}`;
const launchOptions = { args: [...CHROMIUM_ARGS] };

/** Phones are held the way the game wants; otherwise the shell's rotate prompt covers the game. */
const phone = (name: "Pixel 7" | "iPhone 15") =>
  GAME.orientation === "landscape" ? devices[`${name} landscape`] : devices[name];

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // One retry on CI, and a test that passes only on the retry still fails the run: a flaky game
  // test is a determinism bug to fix.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      // Tests tagged @touch need a touch device; they run in the phone projects.
      grepInvert: /@touch/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      name: "mobile",
      testMatch: "**/smoke.spec.ts",
      use: { ...phone("Pixel 7"), launchOptions },
    },
    {
      name: "webkit",
      testMatch: "**/smoke.spec.ts",
      use: { ...phone("iPhone 15") },
    },
  ],
  webServer: {
    // `bun run e2e` builds first; this serves dist/ the way a static host would.
    command: `bun run preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
