import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { tempDir } from "./helpers/cli";

const registry = join(import.meta.dirname, "../registry");
const recorded = Schema.decodeUnknownSync(
  Schema.Struct({ "PreToolUse.Bash": Schema.Record(Schema.String, Schema.Unknown) }),
)(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures/hook-input/claude-code-2026-10-26.json"),
      "utf8",
    ),
  ),
);
const Deny = Schema.Struct({
  hookSpecificOutput: Schema.Struct({
    hookEventName: Schema.Literal("PreToolUse"),
    permissionDecision: Schema.Literal("deny"),
    permissionDecisionReason: Schema.NonEmptyString,
  }),
});
const cases = [
  {
    stack: "nuxt",
    source: "adapters/claude",
    hook: "guard-nuxt-commands.ts",
    command: "bun run dev",
    near: "bun run build",
    alternative: "run_in_background",
  },
  {
    stack: "typescript-mcp",
    source: "adapters/claude",
    hook: "guard-typescript-mcp-commands.ts",
    command: "bun run inspect",
    near: "bunx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list",
    alternative: "--cli",
  },
  {
    stack: "hono-api",
    source: "adapters/claude",
    hook: "guard-hono-api-commands.ts",
    command: "bun run dev",
    near: "bun run build",
    alternative: "run_in_background",
  },
  {
    stack: "nestjs-api",
    source: "adapters/claude",
    hook: "guard-nestjs-api-commands.ts",
    command: "bunx nest start --watch",
    near: "bunx nest build",
    alternative: "run_in_background",
  },
  ...["typescript-api", "astro-fullstack"].map((stack) => ({
    stack,
    source: "files",
    hook: "guard-api-commands.ts",
    command: "bun run dev",
    near: "bun run dev:bg",
    alternative: "bun run dev:bg",
  })),
];

describe.each(cases)(
  "$stack session guard",
  ({ stack, source, hook, command, near, alternative }) => {
    const dir = tempDir();
    const hooks = join(dir.path, ".claude/hooks");
    beforeAll(() => {
      mkdirSync(hooks, { recursive: true });
      for (const helper of ["_lib.ts", "_shell.ts"])
        copyFileSync(
          join(registry, "fragments/claude-harness/files/.claude/hooks", helper),
          join(hooks, helper),
        );
      copyFileSync(
        join(registry, "stacks", stack, source, ".claude/hooks", hook),
        join(hooks, hook),
      );
    });
    afterAll(() => dir.cleanup());

    function run(input: string) {
      const result = spawnSync("bun", [join(hooks, hook)], {
        cwd: dir.path,
        input,
        encoding: "utf8",
        timeout: 10_000,
        env: { HOME: dir.path, PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: dir.path },
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    }
    const payload = (command: string, background = false) =>
      JSON.stringify({
        ...recorded["PreToolUse.Bash"],
        cwd: dir.path,
        tool_input: { command, run_in_background: background },
      });

    test("denies a foreground process with a non-blocking alternative", () => {
      const result = run(payload(command));
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
      const deny = Schema.decodeUnknownSync(Deny)(JSON.parse(result.stdout));
      expect(deny.hookSpecificOutput.permissionDecisionReason).toContain(alternative);
    });
    test.each(["&&", "||"])("still denies a foreground server before %s", (operator) => {
      const result = run(payload(`${command} ${operator} echo ready`));
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
      const deny = Schema.decodeUnknownSync(Deny)(JSON.parse(result.stdout));
      expect(deny.hookSpecificOutput.permissionDecisionReason).toContain(alternative);
    });
    if (stack === "nuxt") {
      test("denies a foreground server with Bun global options", () => {
        const result = run(payload("bun --cwd . run dev"));
        expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
        const deny = Schema.decodeUnknownSync(Deny)(JSON.parse(result.stdout));
        expect(deny.hookSpecificOutput.permissionDecisionReason).toContain(alternative);
      });
    }
    test.each([
      ["near miss", payload(near)],
      ["background", payload(command, true)],
      ["shell background", payload(`${command} &`)],
      ["background pipeline", payload(`${command} | cat &`)],
      ["background shell", payload(`sh -c '${command}' &`)],
      ["nested background", payload(`sh -c '${command} &'`)],
      ["last background command", payload(`echo ready; ${command} &`)],
      ["background AND list", payload(`${command} && echo done &`)],
      ["background OR list", payload(`${command} || echo done &`)],
      ["quoted mention", payload(`git commit -m '${command}'`)],
      [
        "conventions",
        payload("bun test; bunx --bun vitest run; bun add @effect/schema zod; bun src/main.ts"),
      ],
    ])("allows %s", (_, input) => {
      expect(run(input)).toEqual({ status: 0, stdout: "", stderr: "" });
    });
    test("allows an unreadable payload with one stderr note", () => {
      const result = run("not json");
      expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "" });
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(result.stderr).toContain("allow");
    });
    test.each(["missing Bun", "missing script"])(
      "the wired wrapper allows %s with one stderr note",
      (failure) => {
        const settings = Schema.decodeUnknownSync(
          Schema.Struct({
            hooks: Schema.Struct({
              PreToolUse: Schema.Array(
                Schema.Struct({
                  hooks: Schema.Array(Schema.Struct({ command: Schema.String })),
                }),
              ),
            }),
          }),
        )(
          JSON.parse(
            readFileSync(
              join(registry, "stacks", stack, "adapters/claude/.claude/settings.json"),
              "utf8",
            ),
          ),
        );
        const command = settings.hooks.PreToolUse.flatMap((group) => group.hooks).find((item) =>
          item.command.includes(hook),
        )?.command;
        expect(command).toBeDefined();
        if (command === undefined) throw new Error("Missing stack guard wiring");
        const result = spawnSync("/bin/sh", ["-c", command], {
          cwd: dir.path,
          input: payload("bun run dev"),
          encoding: "utf8",
          timeout: 10_000,
          env: {
            PATH: failure === "missing Bun" ? "" : (process.env.PATH ?? ""),
            CLAUDE_PROJECT_DIR: failure === "missing script" ? join(dir.path, "absent") : dir.path,
          },
        });
        expect(result.error).toBeUndefined();
        expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "" });
        expect(result.stderr.trim().split("\n")).toHaveLength(1);
        expect(result.stderr).toContain("allowing");
      },
    );
  },
);
