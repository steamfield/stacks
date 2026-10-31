import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { adapterWorkspace, guardCommands, scaffoldAdapters } from "./helpers/native-adapters";

const space = adapterWorkspace();
afterEach(() => space.cleanup());

const cases = ["astro-fullstack", "typescript-api"].flatMap((stack) =>
  (["codex", "claude,codex"] as const).map((selection) => ({ stack, selection })),
);

test.each(cases)(
  "$stack supplies Codex's complete Bash guards with --agents $selection",
  async ({ stack, selection }) => {
    const result = await scaffoldAdapters({
      home: space.temp(),
      stack,
      agents: selection === "codex" ? ["codex"] : ["claude", "codex"],
    });
    const commands = guardCommands(result.project, "codex", "Bash");
    expect(commands).toHaveLength(2);
    for (const file of ["block-destructive.sh", "guard-api-commands.ts"]) {
      expect(commands.filter((command) => command.includes(`/.claude/hooks/${file}`))).toHaveLength(
        1,
      );
    }
    for (const command of commands) {
      const paths = [...command.matchAll(/\$root\/(\.[^"\s]+)/g)].map((match) => match[1]);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toBeDefined();
        expect(existsSync(join(result.project, path ?? "")), command).toBe(true);
      }
    }
    for (const file of ["_lib.ts", "_shell.ts", "_lib.sh", "_destructive-patterns.sh"])
      expect(existsSync(join(result.project, ".claude/hooks", file)), file).toBe(true);

    const agents = readFileSync(join(result.project, "AGENTS.md"), "utf8");
    expect(agents).toContain("## Agent harness");
    expect(agents).toMatch(/stacks:fill[^\n]*rule[^\n]*paths/);
    expect(agents).toContain("Codex does not load `.claude/rules/` automatically");
    expect(agents).toContain("reads the rules covering the files it changes");
    expect(agents).toContain("../.claude/skills");

    // Run the project's own tests without installing or building the application.
    symlinkSync(
      join(import.meta.dirname, "../node_modules"),
      join(result.project, "node_modules"),
      "dir",
    );
    const run = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "../node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        join(import.meta.dirname, "fixtures/native-adapters/vitest-hooks.config.ts"),
        "tests/hooks/codex-wiring.test.ts",
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
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("4 passed");
  },
  // Real scaffolding and a nested Vitest run of the shipped hooks, with no application install.
  30_000,
);
