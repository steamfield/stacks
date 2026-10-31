import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "api",
          environment: "node",
          include: [
            "apps/api/src/**/*.test.ts",
            "apps/api/tests/**/*.test.ts",
            "packages/contract/src/**/*.test.ts",
          ],
          setupFiles: ["./apps/api/tests/helpers/setup.ts"],
          testTimeout: 30_000,
        },
      },
      "./apps/web/vitest.config.ts",
      {
        test: {
          name: "hooks",
          environment: "node",
          include: ["tests/hooks/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["apps/api/src/**/*.ts", "packages/contract/**/*.ts", "apps/web/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.*"],
      thresholds: { statements: 90, lines: 90, branches: 80, functions: 80 },
    },
  },
});
