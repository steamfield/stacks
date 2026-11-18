import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// One config for `vite` (dev, build, preview) and Vitest (the `test` block), so tests compile the
// app exactly as the build does.

// With PORT_API set in the shell, `vite` and `vite preview` (which reuses server.proxy) forward
// /api/<path> to <path> on that port, so the default same-origin base URL reaches a local API.
// Unset, nothing is proxied and the app runs against whatever answers /api.
const apiPort = process.env.PORT_API;
const proxy = {
  "/api/": {
    target: `http://localhost:${apiPort}`,
    rewrite: (path: string) => path.slice("/api".length),
  },
};

export default defineConfig({
  plugins: [react()],
  server: apiPort ? { proxy } : {},
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
