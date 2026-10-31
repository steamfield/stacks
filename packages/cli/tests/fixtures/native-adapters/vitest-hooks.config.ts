import { defineConfig } from "vitest/config";

// Harness probes run before a scaffold has installed its application dependencies.
export default defineConfig({
  test: { environment: "node", include: ["tests/hooks/**/*.test.ts"] },
});
