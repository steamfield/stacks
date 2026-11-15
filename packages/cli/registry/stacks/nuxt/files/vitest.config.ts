import { fileURLToPath } from "node:url";
import { defineVitestProject } from "@nuxt/test-utils/config";
import { defineConfig } from "vitest/config";

const shared = fileURLToPath(new URL("./shared", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        // Plain Node: shared schemas and server utilities.
        resolve: { alias: { "#shared": shared } },
        test: {
          name: "unit",
          environment: "node",
          include: ["shared/**/*.test.ts", "server/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["tests/db/**"],
          testTimeout: 30_000,
        },
      },
      // Components and pages, mounted inside a Nuxt app with happy-dom.
      await defineVitestProject({
        test: {
          name: "nuxt",
          environment: "nuxt",
          include: ["app/**/*.test.ts"],
          environmentOptions: { nuxt: { domEnvironment: "happy-dom" } },
        },
      }),
    ],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,vue}", "server/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});
