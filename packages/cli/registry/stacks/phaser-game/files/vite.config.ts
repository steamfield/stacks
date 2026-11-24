/**
 * One config for `vite` (dev, build, preview) and Vitest (the `test` block). The game is served at
 * `/`; built assets go under `_v/` so a host can cache them forever while `index.html` stays fresh.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/",
  build: {
    assetsDir: "_v",
    sourcemap: false,
    // Phaser alone is over a megabyte minified; the default 500 kB warning would fire every build.
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: { include: ["phaser"] },
  test: {
    reporters: ["dot"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/logic/**/*.test.ts", "src/kit/**/*.test.ts", "tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: { name: "runtime", environment: "node", include: ["src/engine/**/*.test.ts"] },
      },
    ],
  },
});
