import { defineConfig } from "vitest/config";
// The root suite tests the repo harness (.claude/hooks and scripts/delegate.sh); each workspace
// package runs its own.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
