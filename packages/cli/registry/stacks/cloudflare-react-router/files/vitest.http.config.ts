import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "http",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});
