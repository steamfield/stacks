import { defineConfig } from "vitest/config";

// One config for `vite` (dev, build, preview) and Vitest (the `test` block), so tests compile the
// game exactly as the build does.

export default defineConfig({
  // Relative asset URLs would break under a nested path; set this when the game is hosted below /.
  base: "/",
  build: {
    // Hashed assets go under _v/, the one folder a host can serve as immutable.
    assetsDir: "_v",
    target: "es2023",
    sourcemap: false,
    // three.js alone is over Vite's default warning size, and Rapier's lazily loaded chunk, with
    // its WASM inlined as base64, is over 4 MB. A chunk past this limit is new weight to look at.
    chunkSizeWarningLimit: 5000,
  },
  // Pre-bundled at startup, so the first dev run doesn't reload the page partway through loading.
  optimizeDeps: { include: ["three", "@dimforge/rapier3d-compat"] },
  test: {
    // Dots for passes, full detail for failures. Use --reporter=verbose to list every test.
    reporters: ["dot"],
    projects: [
      {
        extends: true,
        test: {
          name: "logic",
          environment: "node",
          include: ["src/logic/**/*.test.ts", "src/kit/core/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["src/logic/**", "src/kit/core/**"],
        },
      },
    ],
  },
});
