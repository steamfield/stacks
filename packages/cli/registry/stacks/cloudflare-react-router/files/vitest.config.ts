import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["./vitest.workers.config.ts", "./vitest.http.config.ts"],
    coverage: {
      provider: "istanbul",
      include: ["app/.server/**/*.ts", "workers/scheduled.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: { statements: 90, lines: 90, branches: 80, functions: 90 },
    },
  },
});
