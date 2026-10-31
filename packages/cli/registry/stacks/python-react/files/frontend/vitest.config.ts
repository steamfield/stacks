import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
    env: { VITE_PUBLIC_POSTHOG_KEY: "" },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["app/lib/**/*.{ts,tsx}", "app/components/**/*.{ts,tsx}"],
      exclude: ["**/*.test.*"],
      thresholds: { lines: 80, statements: 80, branches: 70, functions: 75 },
    },
  },
});
