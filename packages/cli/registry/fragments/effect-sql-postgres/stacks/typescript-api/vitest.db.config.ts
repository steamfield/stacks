// test:db: tests/db/ only, on Node, with the same credential-clearing setup as the base config.
// `test` skips tests/db/ once the base config excludes it (a Setup step).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["./tests/helpers/setup.ts"],
    globalSetup: ["./tests/db/global-setup.ts"],
    // The first file waits for the template.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
