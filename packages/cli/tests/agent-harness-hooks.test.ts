import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { tempDir } from "./helpers/cli";

const fragments = join(import.meta.dirname, "../registry/fragments");
const shellSource = join(fragments, "agent-ops/files/.claude/hooks");
const Denial = Schema.Struct({
  hookSpecificOutput: Schema.Struct({
    hookEventName: Schema.Literal("PreToolUse"),
    permissionDecision: Schema.Literal("deny"),
    permissionDecisionReason: Schema.NonEmptyString,
  }),
});
const patterns = Schema.decodeUnknownSync(
  Schema.Struct({
    patterns: Schema.Array(
      Schema.Struct({
        pattern: Schema.String,
        blocked: Schema.Array(Schema.String),
        allowed: Schema.Array(Schema.String),
      }),
    ),
  }),
)(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures/hook-input/destructive-commands.json"),
      "utf8",
    ),
  ),
).patterns;
const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});

function project() {
  const dir = tempDir();
  dirs.push(dir);
  cpSync(shellSource, join(dir.path, ".claude/hooks"), { recursive: true });
  return dir.path;
}

function run(
  root: string,
  program: string,
  args: string[],
  options: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? root,
    input: options.input ?? "",
    encoding: "utf8",
    timeout: 10_000,
    env: {
      HOME: root,
      PATH: process.env.PATH,
      CLAUDE_PROJECT_DIR: root,
      GIT_CONFIG_NOSYSTEM: "1",
      ...options.env,
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function hook(root: string, command: string, cwd = root) {
  return run(root, "/bin/bash", [join(root, ".claude/hooks/block-destructive.sh")], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    cwd,
  });
}

function denied(result: ReturnType<typeof run>) {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  const decision = Schema.decodeUnknownSync(Denial)(JSON.parse(result.stdout));
  expect(decision.hookSpecificOutput.permissionDecisionReason).toMatch(/ask the user first/i);
}

test.each(
  patterns.flatMap(({ pattern, blocked }) => blocked.map((command) => ({ pattern, command }))),
)("the shared guard denies $command ($pattern)", ({ command }) => {
  denied(hook(project(), command));
});

test.each(
  patterns.flatMap(({ pattern, allowed }) => allowed.map((command) => ({ pattern, command }))),
)("the shared guard allows $command ($pattern)", ({ command }) => {
  expect(hook(project(), command)).toEqual({ status: 0, stdout: "", stderr: "" });
});

test.each(patterns.flatMap(({ blocked }) => blocked))(
  "a quoted mention is allowed: %s",
  (command) => {
    const root = project();
    expect(hook(root, `git commit -m '${command}'`)).toEqual({ status: 0, stdout: "", stderr: "" });
  },
);

test("absolute removal respects the project boundary and resolves symlinks", () => {
  const root = project();
  const outside = project();
  mkdirSync(join(root, "dist"));
  symlinkSync(outside, join(root, "outside-link"));
  symlinkSync(root, join(root, "project café link"));
  denied(hook(root, `rm -rf '${outside}'`));
  denied(hook(root, `rm -rf '${root}/outside-link'`));
  for (const path of [join(root, "dist"), join(root, "project café link/dist")])
    expect(hook(root, `rm -rf '${path}'`)).toEqual({ status: 0, stdout: "", stderr: "" });
});

test("the shared guard resolves from its own path with an unrelated working directory", () => {
  const root = project();
  const outside = project();
  const alias = join(root, "project café link");
  symlinkSync(root, alias);
  denied(hook(alias, "git reset --hard", outside));
  expect(hook(alias, 'echo "rm -rf /"', outside)).toEqual({ status: 0, stdout: "", stderr: "" });
});

const CodexHooks = Schema.Struct({
  hooks: Schema.Struct({
    PreToolUse: Schema.Array(
      Schema.Struct({
        matcher: Schema.String,
        hooks: Schema.Array(Schema.Struct({ command: Schema.String })),
      }),
    ),
  }),
});

test("smoke checks the existence of every wired Claude hook", () => {
  const root = project();
  cpSync(join(fragments, "agent-ops/adapters/claude/.claude/hooks"), join(root, ".claude/hooks"), {
    recursive: true,
  });
  for (const source of ["files", "adapters/claude"])
    cpSync(
      join(fragments, "claude-harness", source, ".claude/hooks"),
      join(root, ".claude/hooks"),
      {
        recursive: true,
      },
    );
  const Settings = Schema.Struct({
    hooks: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
  });
  const settings = Schema.decodeUnknownSync(Settings)(
    JSON.parse(
      readFileSync(join(fragments, "agent-ops/adapters/claude/.claude/settings.json"), "utf8"),
    ),
  );
  const overlay = Schema.decodeUnknownSync(Settings)(
    JSON.parse(
      readFileSync(join(fragments, "claude-harness/adapters/claude/.claude/settings.json"), "utf8"),
    ),
  );
  writeFileSync(
    join(root, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        ...settings.hooks,
        PostToolUse: [...(settings.hooks.PostToolUse ?? []), ...(overlay.hooks.PostToolUse ?? [])],
      },
    }),
  );
  const args = [join(root, ".claude/hooks/smoke.sh")];
  expect(run(root, "/bin/bash", args)).toEqual({
    status: 0,
    stdout: "hooks-smoke: guards and hook configs OK\n",
    stderr: "",
  });
  rmSync(join(root, ".claude/hooks/typecheck-on-write.ts"));
  const result = run(root, "/bin/bash", args);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "hooks-smoke: .claude/settings.json references missing .claude/hooks/typecheck-on-write.ts\n",
  );
});

function adapter(root: string, agent: "claude" | "codex" | "cursor" | "opencode") {
  if (agent === "claude")
    return { program: "/bin/bash", args: [join(root, ".claude/hooks/block-destructive.sh")] };
  cpSync(join(fragments, "agent-ops/adapters", agent), root, { recursive: true });
  if (agent === "cursor")
    return { program: "/bin/bash", args: [join(root, ".cursor/hooks/guard.sh")] };
  if (agent === "codex") {
    const git = run(root, "git", ["init", "--quiet"]);
    expect(git).toEqual({ status: 0, stdout: "", stderr: "" });
    const config = Schema.decodeUnknownSync(CodexHooks)(
      JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8")),
    );
    const command = config.hooks.PreToolUse.find(({ matcher }) => new RegExp(matcher).test("Bash"))
      ?.hooks[0]?.command;
    expect(command).toBeDefined();
    return { program: "/bin/sh", args: ["-c", command ?? ""] };
  }
  const runner = join(root, "run-plugin.mjs");
  writeFileSync(
    runner,
    [
      'import { $ } from "bun";',
      'import { AgentOps } from "./.opencode/plugins/agent-ops.js";',
      "const plugin = await AgentOps({ $, directory: process.cwd() });",
      'await plugin["tool.execute.before"]({ tool: "bash" }, { args: { command: "echo ok" } });',
    ].join("\n"),
  );
  return { program: "bun", args: [runner] };
}

test.each(
  (["claude", "codex", "cursor", "opencode"] as const).flatMap((agent) =>
    (["missing", "failing"] as const).map((failure) => ({ agent, failure })),
  ),
)(
  "$agent allows the call with one stderr note when its guard is $failure",
  ({ agent, failure }) => {
    const root = project();
    const wrapper = adapter(root, agent);
    const guard = join(
      root,
      ".claude/hooks",
      agent === "claude" ? "_destructive-patterns.sh" : "block-destructive.sh",
    );
    if (failure === "missing") rmSync(guard);
    else writeFileSync(guard, "#!/usr/bin/env bash\nreturn 7 2>/dev/null || exit 7\n");
    const result = run(root, wrapper.program, wrapper.args, {
      input: JSON.stringify({
        tool_name: agent === "cursor" ? "Shell" : "Bash",
        tool_input: { command: "echo ok" },
      }),
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr.trim()).not.toBe("");
    if (agent === "cursor") expect(JSON.parse(result.stdout)).toEqual({ permission: "allow" });
    else expect(result.stdout).toBe("");
  },
);

test.each(["{broken", JSON.stringify({ tool_name: "Write", tool_input: { content: "hello" } })])(
  "Cursor allows an unreadable payload or path with one stderr note: %s",
  (input) => {
    const root = project();
    const wrapper = adapter(root, "cursor");
    const result = run(root, wrapper.program, wrapper.args, { input });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ permission: "allow" });
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr.trim()).not.toBe("");
  },
);

test("Cursor protects absolute paths when CLAUDE_PROJECT_DIR is initially unset", () => {
  const root = project();
  const outside = project();
  const wrapper = adapter(root, "cursor");
  const result = run(root, wrapper.program, wrapper.args, {
    env: { CLAUDE_PROJECT_DIR: undefined },
    input: JSON.stringify({ tool_name: "Shell", tool_input: { command: `rm -rf '${outside}'` } }),
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const decision = Schema.decodeUnknownSync(
    Schema.Struct({
      permission: Schema.Literal("deny"),
      user_message: Schema.NonEmptyString,
      agent_message: Schema.NonEmptyString,
    }),
  )(JSON.parse(result.stdout));
  expect(decision.agent_message).toMatch(/ask the user first/i);
});

test.each(["awk", "grep"])(
  "a matcher %s failure allows the call with one stderr note",
  (program) => {
    const root = project();
    const bin = join(root, "bin");
    mkdirSync(bin);
    const executable = join(bin, program);
    writeFileSync(executable, "#!/bin/sh\nexit 7\n");
    chmodSync(executable, 0o755);
    const result = run(root, "/bin/bash", [join(root, ".claude/hooks/block-destructive.sh")], {
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr.trim()).not.toBe("");
  },
);
