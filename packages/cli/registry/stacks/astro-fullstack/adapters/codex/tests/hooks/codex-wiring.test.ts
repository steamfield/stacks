import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const project = resolve(import.meta.dirname, "../..");
const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function bashCommands() {
  const config: unknown = JSON.parse(readFileSync(join(project, ".codex/hooks.json"), "utf8"));
  assert(config && typeof config === "object" && "hooks" in config);
  const hooks = config.hooks;
  assert(hooks && typeof hooks === "object" && "PreToolUse" in hooks);
  assert(Array.isArray(hooks.PreToolUse));
  const commands: string[] = [];
  for (const group of hooks.PreToolUse) {
    assert(typeof group.matcher === "string" && Array.isArray(group.hooks));
    if (!new RegExp(group.matcher).test("Bash")) continue;
    for (const hook of group.hooks) {
      assert(typeof hook.command === "string");
      commands.push(hook.command);
    }
  }
  return commands;
}

// A real checkout even on test hosts without .git, with no stack build or install needed.
function checkout() {
  const dir = mkdtempSync(join(tmpdir(), "codex api hooks "));
  fixtures.push(dir);
  cpSync(join(project, ".claude/hooks"), join(dir, ".claude/hooks"), { recursive: true });
  expect(spawnSync("git", ["init", "--quiet", dir], { env: env() }).status).toBe(0);
  mkdirSync(join(dir, "nested"));
  return dir;
}

function env() {
  return { PATH: process.env.PATH ?? "", HOME: tmpdir() };
}

function run(command: string, input: string, dir: string) {
  const payload = join(dir, "payload.json");
  writeFileSync(
    payload,
    JSON.stringify({
      session_id: "codex-hook-test",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: join(dir, "nested"),
      tool_input: { command: input },
    }),
  );
  // Refusals exit without reading stdin; a file avoids racing that exit with a pipe write (EPIPE).
  const stdin = openSync(payload, "r");
  try {
    const result = spawnSync("sh", ["-c", command], {
      cwd: join(dir, "nested"),
      env: env(),
      stdio: [stdin, "pipe", "pipe"],
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    closeSync(stdin);
  }
}

describe("Codex hook wiring", () => {
  it("runs the API command guard and allows the supported test runner", () => {
    const dir = checkout();
    const commands = bashCommands();
    expect(commands.filter((c) => c.includes("/block-destructive.sh"))).toHaveLength(1);
    expect(commands.filter((c) => c.includes("/guard-api-commands.ts"))).toHaveLength(1);
    const denied = commands.map((c) => run(c, "bun test", dir));
    for (const result of denied) {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    }
    expect(denied.filter((r) => r.stdout !== "").map((r) => JSON.parse(r.stdout))).toEqual([
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("bun run test"),
        },
      },
    ]);
    for (const command of commands)
      expect(run(command, "bun run test", dir)).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("refuses a command when the API guard is missing", () => {
    const dir = checkout();
    rmSync(join(dir, ".claude/hooks/guard-api-commands.ts"));
    const guards = bashCommands().filter((c) => c.includes("/guard-api-commands.ts"));
    expect(guards).toHaveLength(1);
    for (const command of guards) {
      const result = run(command, "bun run test", dir);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("BLOCKED: .claude/hooks/guard-api-commands.ts not found");
    }
  });

  it.each(["missing helper", "crashing guard"])("refuses a command with a %s", (failure) => {
    const dir = checkout();
    if (failure === "missing helper") {
      rmSync(join(dir, ".claude/hooks/_lib.ts"));
    } else {
      writeFileSync(
        join(dir, ".claude/hooks/guard-api-commands.ts"),
        'throw new Error("guard failed");\n',
      );
    }
    const guards = bashCommands().filter((c) => c.includes("/guard-api-commands.ts"));
    expect(guards).toHaveLength(1);
    for (const command of guards) {
      const result = run(command, "bun run test", dir);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("BLOCKED: .claude/hooks/guard-api-commands.ts failed to run");
    }
  });
});
