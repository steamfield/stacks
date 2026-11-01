// test:db: tests/db/ only, in Node. Like the base config, it maps server-only to the test helper
// so server modules load outside Next.js. The base config excludes tests/db/ from `test`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["./tests/db/global-setup.ts"],
    // The first file waits for the template.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
