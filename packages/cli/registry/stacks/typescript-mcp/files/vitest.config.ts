import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts is the process entry (env, signals, stdio); tests/stdio.test.ts runs it in a child
      // process, where coverage can't see it.
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: { statements: 90, lines: 90, branches: 85, functions: 90 },
    },
  },
});
