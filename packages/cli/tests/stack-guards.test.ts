import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
    hook: "guard-nuxt-commands.sh",
    command: "bun run dev",
    near: "bun run build",
    alternative: "run_in_background",
    denied: [
      "npx nuxi@latest preview",
      "nuxt dev",
      "bun run start",
      "node .output/server/index.mjs",
    ],
    allowed: ["nuxi build", "bun run dev:bg", "npm --workspace dev run build", "echo nuxt dev"],
  },
  {
    stack: "typescript-mcp",
    source: "adapters/claude",
    hook: "guard-typescript-mcp-commands.sh",
    command: "bun run inspect",
    near: "bunx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list",
    alternative: "--cli",
    denied: [
      "npx @modelcontextprotocol/inspector",
      "mcp-inspector node dist/index.js",
      "npm --cwd . run inspect",
    ],
    allowed: [
      "bun add @modelcontextprotocol/inspector",
      "mcp-inspector --cli node dist/index.js",
      "bun run smoke",
      "echo mcp-inspector",
    ],
  },
  {
    stack: "hono-api",
    source: "adapters/claude",
    hook: "guard-hono-api-commands.sh",
    command: "bun run dev",
    near: "bun run build",
    alternative: "run_in_background",
    denied: ["bun --cwd . run dev", "npm run dev", "yarn dev"],
    allowed: ["bunx dev", "bun run dev:bg", "bun --cwd dev run build", "echo bun run dev"],
  },
  {
    stack: "nestjs-api",
    source: "adapters/claude",
    hook: "guard-nestjs-api-commands.sh",
    command: "bunx nest start --watch",
    near: "bunx nest build",
    alternative: "run_in_background",
    denied: ["nest start -w", "npx @nestjs/cli@latest start --watch", "bun --cwd . run dev"],
    allowed: ["nest start", "nest build --watch", "npx dev", "bun --cwd dev run build"],
  },
  ...["typescript-api", "astro-fullstack"].map((stack) => ({
    stack,
    source: "files",
    hook: "guard-api-commands.sh",
    command: "bun run dev",
    near: "bun run dev:bg",
    alternative: "bun run dev:bg",
    denied: ["bun --cwd apps/api run dev", "npm --workspace api run dev", "pnpm -F api dev"],
    allowed: ["bunx dev", "bun run dev:stop", "npm --workspace dev run build", "echo bun run dev"],
  })),
];

describe.each(cases)(
  "$stack session guard",
  ({ stack, source, hook, command, near, alternative, denied, allowed }) => {
    const dir = tempDir();
    const hooks = join(dir.path, ".claude/hooks");
    beforeAll(() => {
      mkdirSync(hooks, { recursive: true });
      copyFileSync(
        join(registry, "fragments/agent-ops/files/.claude/hooks/_lib.sh"),
        join(hooks, "_lib.sh"),
      );
      copyFileSync(
        join(registry, "stacks", stack, source, ".claude/hooks", hook),
        join(hooks, hook),
      );
    });
    afterAll(() => dir.cleanup());

    function run(input: string, path = process.env.PATH ?? "") {
      const result = spawnSync("/bin/bash", [join(hooks, hook)], {
        cwd: dir.path,
        input,
        encoding: "utf8",
        timeout: 10_000,
        env: { HOME: dir.path, PATH: path, CLAUDE_PROJECT_DIR: dir.path },
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
    test.each(denied)("denies the existing anti-hang form: %s", (command) => {
      const result = run(payload(command));
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
      const deny = Schema.decodeUnknownSync(Deny)(JSON.parse(result.stdout));
      expect(deny.hookSpecificOutput.permissionDecisionReason).toContain(alternative);
    });
    test.each(allowed)("allows a nearby command: %s", (command) => {
      expect(run(payload(command))).toEqual({ status: 0, stdout: "", stderr: "" });
    });
    const script = stack === "typescript-mcp" ? "inspect" : "dev";
    test.each([`bun --cwd "my project" run ${script}`, `"/opt/my tools/bun" run ${script}`])(
      "denies a foreground process with spaces in an argument: %s",
      (command) => {
        const result = run(payload(command));
        expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
        const deny = Schema.decodeUnknownSync(Deny)(JSON.parse(result.stdout));
        expect(deny.hookSpecificOutput.permissionDecisionReason).toContain(alternative);
      },
    );
    test("allows a different script whose name contains spaces", () => {
      expect(run(payload(`bun run "${script} extra"`))).toEqual({
        status: 0,
        stdout: "",
        stderr: "",
      });
    });
    test("denies a foreground process at the start of a long command list", () => {
      const result = run(payload(`${command}; ${"echo a;".repeat(10_000)}`));
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
    test.each(["not json", "", "   ", "null"])(
      "allows an unreadable payload with one stderr note: %s",
      (input) => {
        const result = run(input);
        expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "" });
        expect(result.stderr.trim().split("\n")).toHaveLength(1);
        expect(result.stderr).toContain("allow");
      },
    );
    test("allows calls without jq with one stderr note", () => {
      const result = run(payload(command), "");
      expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "" });
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(result.stderr).toContain("jq");
      expect(result.stderr).toContain("allowing");
    });
    test("allows calls without the shared helper with one stderr note", () => {
      const helper = join(hooks, "_lib.sh");
      rmSync(helper);
      try {
        const result = run(payload(command));
        expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "" });
        expect(result.stderr.trim().split("\n")).toHaveLength(1);
        expect(result.stderr).toContain("allowing");
      } finally {
        copyFileSync(join(registry, "fragments/agent-ops/files/.claude/hooks/_lib.sh"), helper);
      }
    });
    test.each(["missing bash", "missing script"])(
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
            PATH: failure === "missing bash" ? "" : (process.env.PATH ?? ""),
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
