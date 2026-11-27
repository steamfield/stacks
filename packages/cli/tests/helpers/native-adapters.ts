import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentId } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { expect } from "vitest";
import { NewResult } from "../../src/schemas/new";
import { quiet, runCli, tempDir } from "./cli";

export const adapterRegistry = join(import.meta.dirname, "..", "fixtures", "registry-adapters");
export const samples = join(import.meta.dirname, "..", "fixtures", "native-adapters");
export const nativeAgents = ["codex", "opencode", "cursor"] as const;

export function adapterWorkspace() {
  const dirs: ReturnType<typeof tempDir>[] = [];
  return {
    temp() {
      const dir = tempDir();
      dirs.push(dir);
      return realpathSync(dir.path);
    },
    cleanup() {
      for (const dir of dirs.splice(0)) dir.cleanup();
    },
  };
}

export async function scaffoldAdapters(options: {
  home: string;
  agents: readonly AgentId[];
  registry?: string;
  stack?: string;
  fragments?: readonly string[];
  without?: readonly string[];
  name?: string;
  env?: Record<string, string>;
}) {
  const result = await runCli(
    [
      "new",
      options.stack ?? "go-cli",
      options.name ?? "app",
      "--agents",
      options.agents.join(","),
      "--no-launch",
      "--json",
      ...(options.fragments ?? []).flatMap((id) => ["--with", id]),
      ...(options.without ?? []).flatMap((id) => ["--without", id]),
    ],
    {
      home: options.home,
      env: { ...quiet, PATH: process.env.PATH ?? "", ...options.env },
      host: { cwd: options.home, registry: options.registry ?? adapterRegistry },
    },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  const decoded = Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  expect(decoded.git).toBe("fresh");
  expect(decoded.written).toEqual([...decoded.written].sort());
  return decoded;
}

const Command = Schema.Struct({ command: Schema.String });
const Group = Schema.Struct({
  matcher: Schema.optionalKey(Schema.String),
  hooks: Schema.Array(Command),
});
const ClaudeHooks = Schema.Struct({ hooks: Schema.Record(Schema.String, Schema.Array(Group)) });
const CursorCommand = Schema.Struct({
  command: Schema.String,
  matcher: Schema.optionalKey(Schema.String),
});
const CursorHooks = Schema.Struct({
  hooks: Schema.Record(Schema.String, Schema.Array(CursorCommand)),
});

/** Select the commands the agent would dispatch, including its matcher semantics. */
export function guardCommands(project: string, agent: "claude" | "codex" | "cursor", tool: string) {
  if (agent === "cursor") {
    const settings = Schema.decodeUnknownSync(CursorHooks)(
      JSON.parse(readFileSync(join(project, ".cursor/hooks.json"), "utf8")),
    );
    const groups = settings.hooks.preToolUse ?? [];
    return groups
      .filter((g) => !g.matcher || g.matcher === "*" || new RegExp(g.matcher).test(tool))
      .map((g) => g.command);
  }
  const file = agent === "codex" ? ".codex/hooks.json" : ".claude/settings.json";
  const settings = Schema.decodeUnknownSync(ClaudeHooks)(
    JSON.parse(readFileSync(join(project, file), "utf8")),
  );
  return (settings.hooks.PreToolUse ?? [])
    .filter((g) => {
      if (!g.matcher || g.matcher === "*") return true;
      const names = agent === "codex" && tool === "apply_patch" ? [tool, "Edit", "Write"] : [tool];
      return names.some((name) => new RegExp(g.matcher ?? "").test(name));
    })
    .flatMap((g) => g.hooks.map((h) => h.command));
}

export function runGuard(options: {
  project: string;
  command: string;
  payload: unknown;
  agent: "claude" | "codex" | "cursor";
}) {
  const tmp = join(options.project, "..", "hook-tmp");
  mkdirSync(tmp, { recursive: true });
  const inputDir = mkdtempSync(join(tmp, "input-"));
  const payload = join(inputDir, "payload.json");
  writeFileSync(payload, JSON.stringify(options.payload), { mode: 0o600 });
  const input = openSync(payload, "r");
  try {
    // Missing guards exit without reading stdin; a file avoids racing that exit with a pipe write.
    const result = spawnSync("/bin/sh", ["-c", options.command], {
      cwd: options.project,
      stdio: [input, "pipe", "pipe"],
      encoding: "utf8",
      timeout: 10_000,
      env: {
        HOME: options.project,
        PATH: process.env.PATH ?? "",
        TMPDIR: tmp,
        ...(options.agent === "claude" ? { CLAUDE_PROJECT_DIR: options.project } : {}),
        ...(options.agent === "cursor"
          ? { CLAUDE_PROJECT_DIR: options.project, CURSOR_PROJECT_DIR: options.project }
          : {}),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return result;
  } finally {
    closeSync(input);
    rmSync(inputDir, { recursive: true, force: true });
  }
}

const Deny = Schema.Struct({
  hookSpecificOutput: Schema.Struct({
    hookEventName: Schema.Literal("PreToolUse"),
    permissionDecision: Schema.Literal("deny"),
    permissionDecisionReason: Schema.NonEmptyString,
  }),
});

export function expectBlocked(result: ReturnType<typeof runGuard>, agent: string) {
  if (result.status === 2) {
    expect(result.stderr.trim()).not.toBe("");
    return;
  }
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  if (agent === "cursor") {
    const deny = Schema.decodeUnknownSync(
      Schema.Struct({
        permission: Schema.Literal("deny"),
        user_message: Schema.optionalKey(Schema.String),
        agent_message: Schema.optionalKey(Schema.String),
      }),
    )(JSON.parse(result.stdout));
    expect(deny.permission).toBe("deny");
    expect((deny.user_message ?? deny.agent_message ?? "").trim()).not.toBe("");
  } else Schema.decodeUnknownSync(Deny)(JSON.parse(result.stdout));
}
