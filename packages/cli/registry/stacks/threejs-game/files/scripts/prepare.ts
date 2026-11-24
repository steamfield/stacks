#!/usr/bin/env bun
/**
 * Prepares local development by installing git hooks and Playwright's Chromium browser when
 * their tools are present. Dependency installation runs it outside CI and reports setup
 * failures for manual retry.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

process.chdir(join(import.meta.dirname, ".."));

if (!process.env.CI) {
  // Without lefthook.yml, `lefthook install` writes its own example config into the root.
  const lefthook = existsSync("lefthook.yml")
    ? spawnSync("lefthook", ["install"], { stdio: "inherit" })
    : undefined;
  if ((lefthook?.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    console.log(
      "lefthook not found: git hooks not installed (brew install lefthook, then bun install)",
    );
  } else if (lefthook?.error) {
    throw lefthook.error;
  } else if (lefthook && lefthook.status !== 0) {
    // Not fatal: outside a git checkout lefthook fails, and that mustn't fail `bun install`.
    console.log(
      "lefthook install failed: git hooks not installed (run it again inside the git checkout)",
    );
  }

  // Downloads Chromium the first time; a no-op after that. Skipped until Playwright is installed.
  if (existsSync("node_modules/.bin/playwright")) {
    const playwright = spawnSync("node_modules/.bin/playwright", ["install", "chromium"], {
      stdio: "inherit",
    });
    if (playwright.error || playwright.status !== 0) {
      console.log(
        "Couldn't install Chromium for bun run e2e; retry with: bunx playwright install chromium",
      );
    }
  }
}
