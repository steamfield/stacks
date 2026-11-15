import { defineConfig } from "vitest/config";

// Tooling probes run before a scaffold has installed its application dependencies.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
  },
});
