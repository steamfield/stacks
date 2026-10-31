import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// One config for `vite` (dev, build, preview) and Vitest (the `test` block), so tests compile the
// app exactly as the build does.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "app",
          environment: "happy-dom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: { name: "node", environment: "node", include: ["tests/**/*.test.ts"] },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.*", "src/main.tsx"],
    },
  },
});
