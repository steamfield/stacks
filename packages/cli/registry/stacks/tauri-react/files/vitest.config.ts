import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { aliases } from "./vite.config.ts";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases },
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          environment: "happy-dom",
          include: ["src/**/*.test.{ts,tsx}", "tests/*.test.{ts,tsx}"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: { name: "hooks", environment: "node", include: ["tests/hooks/**/*.test.ts"] },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/core/generated/**", "src/main.tsx", "**/*.test.*"],
    },
  },
});
