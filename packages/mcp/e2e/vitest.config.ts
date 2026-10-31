import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    // Startup, several real CLI calls and SDK teardown each have their own bounded waits.
    testTimeout: 30_000,
  },
});
