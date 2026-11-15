import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import {
  adapterWorkspace,
  guardCommands,
  runGuard,
  scaffoldAdapters,
} from "./helpers/native-adapters";

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

    const guard = commands.find((command) => command.includes("guard-api-commands.ts"));
    expect(guard).toBeDefined();
    if (guard === undefined) throw new Error("Missing API guard");
    const recorded = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, "fixtures/native-adapters/codex-pretooluse.json"),
          "utf8",
        ),
      ),
    );
    const run = runGuard({
      project: result.project,
      command: guard,
      agent: "codex",
      payload: { ...recorded, cwd: result.project, tool_input: { command: "bun run dev" } },
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    const deny = Schema.decodeUnknownSync(
      Schema.Struct({
        hookSpecificOutput: Schema.Struct({
          hookEventName: Schema.Literal("PreToolUse"),
          permissionDecision: Schema.Literal("deny"),
          permissionDecisionReason: Schema.String,
        }),
      }),
    )(JSON.parse(run.stdout));
    expect(deny.hookSpecificOutput.permissionDecisionReason).toContain("bun run dev:bg");
  },
  // Real scaffolding and the wired guard, with no application install.
  30_000,
);
