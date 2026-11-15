#!/usr/bin/env bun
/**
 * Installs lefthook hooks during dependency installation when lefthook.yml exists. It skips CI
 * and reports an unavailable installer without failing bun install.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

process.chdir(join(import.meta.dirname, ".."));

// Without lefthook.yml, `lefthook install` writes its own example config into the root, and the
// first install can run before the project has written one.
if (!process.env.CI && existsSync("lefthook.yml")) {
  const lefthook = spawnSync("lefthook", ["install"], { stdio: "inherit" });
  if ((lefthook.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    console.log(
      "lefthook not found: git hooks not installed (brew install lefthook, then bun install)",
    );
  } else if (lefthook.error) {
    throw lefthook.error;
  } else if (lefthook.status !== 0) {
    // Not fatal: outside a git checkout lefthook fails, and that mustn't fail `bun install`.
    console.log(
      "lefthook install failed: git hooks not installed (run it again inside the git checkout)",
    );
  }
}
