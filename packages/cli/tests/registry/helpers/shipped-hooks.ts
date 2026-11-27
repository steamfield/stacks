/**
 * Runs the hooks a scaffolded project ships the way an agent does: the wired command, a recorded
 * Claude Code payload shape, and the decision read back from the hook's streams.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { compose } from "../../../src/core/compose/compose";
import { composeFiles, NEUTRAL_VARS } from "../../../src/core/compose/files";
import { isStack } from "../../../src/core/registry/entry";
import { Registry } from "../../../src/core/registry/registry";
import { tempDir } from "../../helpers/cli";
import { scaffoldAdapters } from "../../helpers/native-adapters";
import { bundled } from "./bundled";

export const agentOps = join(bundled, "fragments/agent-ops");
export const agents = ["claude", "codex", "cursor", "opencode"] as const;
export type Agent = (typeof agents)[number];
export const Settings = Schema.Struct({
  permissions: Schema.optionalKey(Schema.Struct({ deny: Schema.Array(Schema.String) })),
  hooks: Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({
        matcher: Schema.optionalKey(Schema.String),
        hooks: Schema.Array(Schema.Struct({ command: Schema.String })),
      }),
    ),
  ),
});
const Payload = Schema.Record(Schema.String, Schema.Unknown);
const recorded = Schema.decodeUnknownSync(
  Schema.Struct({
    "PreToolUse.Bash": Payload,
    "PreToolUse.Write": Payload,
    "PreToolUse.Edit": Payload,
    Stop: Payload,
    SessionStart: Payload,
  }),
)(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../fixtures/hook-input/claude-code-2026-10-26.json"),
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

export function fixture() {
  const space = tempDir();
  let serial = 0;
  return {
    path: space.path,
    cleanup: () => space.cleanup(),
    async scaffold() {
      const project = (
        await scaffoldAdapters({ home: space.path, stack: "go-cli", agents, name: "café project" })
      ).project;
      mkdirSync(join(project, "tmp"));
      return project;
    },
    copy(project: string) {
      const root = join(space.path, `copy-${serial++}`);
      // Concurrent hook runs on `project` create and remove files under its TMPDIR while this
      // walks it, so each copy starts with its own empty `tmp/` instead.
      const scratch = join(project, "tmp");
      cpSync(project, root, { recursive: true, filter: (source) => source !== scratch });
      mkdirSync(join(root, "tmp"));
      return root;
    },
  };
}

export function bashPayload(root: string, command: string) {
  return { ...recorded["PreToolUse.Bash"], cwd: root, tool_input: { command } };
}
export function writePayload(root: string, file: string, content: string, session = "write-test") {
  return {
    ...recorded["PreToolUse.Write"],
    cwd: root,
    session_id: session,
    tool_input: { file_path: join(root, file), content },
  };
}
export function eventPayload(root: string, event: "Stop" | "SessionStart", session = "write-test") {
  return { ...recorded[event], cwd: root, session_id: session };
}
export function editPayload(root: string, content: string) {
  return {
    ...recorded["PreToolUse.Edit"],
    cwd: root,
    tool_input: {
      file_path: join(root, "src/config.ts"),
      old_string: "export const value = 1;",
      new_string: content,
    },
  };
}

export function settings(root: string) {
  return Schema.decodeUnknownSync(Settings)(
    JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")),
  );
}
export function hookCommand(root: string, script: string) {
  const commands = Object.values(settings(root).hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks),
  );
  const command = commands.find((hook) => hook.command.includes(`/${script}"`))?.command;
  if (!command) throw new Error(`No wired command for ${script}`);
  return command;
}

const settingsOf = (stack: string, fragments: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const reader = yield* Registry;
    const composition = yield* compose({
      stack,
      agents: ["claude"],
      with: [...fragments],
      without: [],
      always: [],
      preset: "default",
      mode: "new",
    });
    const files = yield* composeFiles(
      {
        ...composition,
        files: composition.files.filter((file) => file.path === ".claude/settings.json"),
      },
      NEUTRAL_VARS,
      reader,
    );
    const file = files.find((file) => file.path === ".claude/settings.json");
    if (!file) throw new Error(`No settings for ${stack}`);
    return Schema.decodeUnknownSync(Settings)(JSON.parse(Buffer.from(file.bytes).toString()));
  });

function withBundledRegistry<A, E>(
  effect: Effect.Effect<A, E, Registry | NodeServices.NodeServices>,
) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(Registry.layer([{ origin: "bundled", path: bundled }])),
      Effect.provide(NodeServices.layer),
    ),
  );
}

export async function composedSettings(stack: string) {
  return await withBundledRegistry(settingsOf(stack, []));
}

/**
 * Every bundled stack's composed settings with all its optional fragments, so each settings
 * merger is taken in. One registry load serves every composition.
 */
export async function bundledStackSettings() {
  return await withBundledRegistry(
    Effect.gen(function* () {
      const stacks = (yield* (yield* Registry).all).filter(isStack);
      return yield* Effect.forEach(stacks, (entry) =>
        Effect.map(settingsOf(entry.id, entry.meta.fragments.optional), (settings) => ({
          id: entry.id,
          settings,
        })),
      );
    }),
  );
}

/**
 * A hook spawn takes well under a second alone, but with these files' concurrent spawns on a
 * loaded 2-core CI runner one took over 4.5 s. A hung hook still fails at this deadline, and the
 * hook files declare a test timeout above it (`HOOK_TEST_TIMEOUT`) for tests that spawn a few.
 */
const HOOK_DEADLINE = 15_000;
export const HOOK_TEST_TIMEOUT = 45_000;

export type Run = { status: number | null; stdout: string; stderr: string };
export async function run(
  root: string,
  command: string,
  payload: unknown,
  options: {
    path?: string;
    raw?: boolean;
    program?: string;
    args?: readonly string[];
    agent?: Agent;
  } = {},
): Promise<Run> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.program ?? "/bin/sh", options.args ?? ["-c", command], {
      cwd: root,
      signal: AbortSignal.timeout(HOOK_DEADLINE),
      env: {
        HOME: root,
        PATH: options.path ?? process.env.PATH,
        TMPDIR: join(root, "tmp"),
        ...(options.agent === undefined || options.agent === "claude"
          ? { CLAUDE_PROJECT_DIR: root }
          : {}),
      },
    });
    let error: Error | undefined;
    let stdout = "",
      stderr = "";
    child.on("error", (cause) => {
      error ??= cause;
    });
    child.stdin.on("error", (cause) => {
      error ??= cause;
    });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (status, signal) => {
      if (error) reject(error);
      else if (signal) reject(new Error(`Hook killed by ${signal}`));
      else resolve({ status, stdout, stderr });
    });
    child.stdin.end(options.raw ? String(payload) : JSON.stringify(payload));
  });
}
export function allowed(result: Run) {
  expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
}
export function noted(result: Run, stdout = "") {
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(stdout);
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(result.stderr).toMatch(/allowing/i);
}
export function denied(result: Run) {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return Schema.decodeUnknownSync(Deny)(JSON.parse(result.stdout)).hookSpecificOutput
    .permissionDecisionReason;
}

/** A real tool PATH with jq omitted, rather than a fake jq that changes the failure. */
export function withoutTool(root: string, omitted: "jq" | "awk") {
  const bin = join(root, `no-${omitted}`);
  mkdirSync(bin);
  for (const tool of [
    "bash",
    "jq",
    "cat",
    "git",
    "sh",
    "dirname",
    "basename",
    "awk",
    "grep",
    "sed",
    "tr",
    "head",
    "wc",
    "mkdir",
    "mktemp",
    "rm",
    "sort",
    "cut",
    "mv",
    "sleep",
    "cmp",
  ]) {
    if (tool === omitted) continue;
    const path = spawnSync("/bin/sh", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    }).stdout.trim();
    if (!path) throw new Error(`Missing test prerequisite: ${tool}`);
    symlinkSync(path, join(bin, tool));
  }
  return bin;
}

/** Real boundary programs that crash, without replacing any hook implementation. */
export function failingTool(root: string, tool: "awk" | "grep", body = "exit 7") {
  const bin = join(root, `broken-${tool}`);
  mkdirSync(bin);
  writeFileSync(join(bin, tool), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return `${bin}:${process.env.PATH ?? ""}`;
}
