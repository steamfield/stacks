import { defineConfig } from "vitest/config";

// Two projects: `behavior` checks the CLI against fixture registries and must keep passing when
// registry content changes; `registry` checks the bundled registry's own content (tests/registry/).
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/bin.ts"] },
    projects: [
      {
        extends: true,
        test: { name: "behavior", include: ["tests/**/*.test.ts"], exclude: ["tests/registry/**"] },
      },
      { extends: true, test: { name: "registry", include: ["tests/registry/**/*.test.ts"] } },
    ],
  },
});
