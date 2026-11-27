import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { adapterWorkspace, scaffoldAdapters } from "../helpers/native-adapters";
import { readManifestAt } from "../helpers/verify";
import { bundled } from "./helpers/bundled";

const space = adapterWorkspace();
afterEach(() => space.cleanup());

const contracts = [
  {
    stack: "typescript-cli",
    steps: { "config-logging": "bun run test:unit tests/config-logging.test.ts" },
  },
  {
    stack: "typescript-api",
    steps: { "http-contract": "bun run test tests/http-contract.test.ts" },
  },
  {
    stack: "astro-fullstack",
    steps: { "http-contract": "bun run test --project api apps/api/tests/http-contract.test.ts" },
  },
  {
    stack: "mobile-expo",
    steps: {
      "harness-contract": "bun run test:api test/harness-contract.test.ts",
      "auth-provider": "bun run test:mobile --runInBand test/auth-provider.test.tsx",
      "ci-contract": "bun run test:ci",
    },
  },
  {
    stack: "typescript-cli",
    fragments: ["openrouter-chat-cli"],
    steps: {
      "app-acceptance": "bun run test:unit tests/app-acceptance.test.ts",
      "app-eval-dry-run": "bun scripts/check-eval-dry-run.ts",
    },
  },
  {
    stack: "react-router",
    fragments: ["openrouter-chat"],
    steps: {
      "app-acceptance": "bun run test tests/app-acceptance.test.ts",
      "app-eval-dry-run": "bun scripts/check-eval-dry-run.ts",
    },
  },
];

test.each(contracts)(
  "$stack requires application acceptance independent of hook coverage",
  async ({ stack, fragments, steps }) => {
    const { project } = await scaffoldAdapters({
      registry: bundled,
      home: space.temp(),
      stack,
      fragments,
      agents: ["codex"],
    });
    const manifest = readManifestAt(project);
    for (const [name, run] of Object.entries(steps)) {
      expect(manifest.verify.find((step) => step.name === name)).toMatchObject({
        run,
        layer: "test",
      });
    }
    const guide = join(project, `docs/acceptance/${fragments?.[0] ?? stack}.md`);
    expect(readFileSync(guide, "utf8").length).toBeGreaterThan(500);
  },
);
