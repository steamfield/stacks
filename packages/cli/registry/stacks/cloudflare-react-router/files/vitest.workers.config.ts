import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./workers/scheduled.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: { name: "workers", include: ["app/**/*.test.ts", "workers/**/*.test.ts"] },
});
