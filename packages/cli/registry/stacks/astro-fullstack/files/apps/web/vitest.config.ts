import { getViteConfig } from "astro/config";
import type { TestUserConfig } from "vitest/config";

const config = {
  root: import.meta.dirname,
  test: {
    name: "web",
    environment: "happy-dom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  } satisfies TestUserConfig,
};

export default getViteConfig(config, { root: import.meta.dirname });
