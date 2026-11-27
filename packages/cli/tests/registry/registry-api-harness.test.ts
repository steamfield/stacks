import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { adapterWorkspace, scaffoldAdapters } from "../helpers/native-adapters";
import { bundled } from "./helpers/bundled";

const space = adapterWorkspace();
afterEach(() => space.cleanup());
const cases = ["astro-fullstack", "typescript-api"].flatMap((stack) =>
  (["claude", "codex", "opencode", "cursor"] as const).map((agent) => ({ stack, agent })),
);

test.each(cases)(
  "$stack ships tooling tests for $agent",
  async ({ stack, agent }) => {
    const result = await scaffoldAdapters({
      registry: bundled,
      home: space.temp(),
      stack,
      agents: [agent],
    });
    for (const file of [
      "scripts/dev-logs.test.ts",
      "scripts/dev-bg.test.ts",
      "scripts/boundaries-lint.test.ts",
      "scripts/helpers/dev.ts",
    ]) {
      expect(existsSync(join(result.project, file)), file).toBe(true);
    }
    symlinkSync(
      join(import.meta.dirname, "../../node_modules"),
      join(result.project, "node_modules"),
      "dir",
    );
    const run = spawnSync(
      process.execPath,
      [
        join(result.project, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        join(import.meta.dirname, "../fixtures/native-adapters/vitest-tooling.config.ts"),
        "scripts/dev-logs.test.ts",
        "--no-color",
        "--maxWorkers",
        "1",
      ],
      {
        cwd: result.project,
        env: { HOME: result.project, PATH: process.env.PATH ?? "" },
        encoding: "utf8",
        timeout: 20_000,
      },
    );
    expect(run.error).toBeUndefined();
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatch(/Tests\s+1 passed/);
  },
  30_000,
);

test("the API tooling tests compile separately from NodeNext application tests", async () => {
  const result = await scaffoldAdapters({
    registry: bundled,
    home: space.temp(),
    stack: "typescript-api",
    agents: ["claude", "codex"],
  });
  symlinkSync(
    join(import.meta.dirname, "../../node_modules"),
    join(result.project, "node_modules"),
    "dir",
  );
  // The stack ships both projects; the application one also covers the shipped src/ and tests/.
  for (const configFile of ["tsconfig.tools.json", "tsconfig.json"]) {
    const checked = spawnSync(join(result.project, "node_modules/.bin/tsc"), ["-p", configFile], {
      cwd: result.project,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(checked.error).toBeUndefined();
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  }
}, 30_000);
