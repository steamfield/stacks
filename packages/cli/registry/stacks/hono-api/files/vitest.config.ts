import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // main.ts is the process entry (env, signals); verify's serve step runs it.
      exclude: ["src/**/*.test.ts", "src/main.ts"],
      thresholds: { statements: 90, lines: 90, branches: 80, functions: 80 },
    },
  },
});
