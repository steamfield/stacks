import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    setupFiles: ["./tests/helpers/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}"],
      exclude: ["app/components/ui/**", "app/**/*.test.*"],
    },
  },
});
