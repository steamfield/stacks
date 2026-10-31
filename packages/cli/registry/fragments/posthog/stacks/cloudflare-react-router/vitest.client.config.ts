import { defineConfig } from "vitest/config";

// Browser-only modules under app/lib/ run in a DOM, never in the Workers pool.
export default defineConfig({
  test: { name: "client", environment: "happy-dom", include: ["app/lib/**/*.test.ts"] },
});
