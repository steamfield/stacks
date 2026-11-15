import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import {
  adapterWorkspace,
  expectBlocked,
  guardCommands,
  runGuard,
  samples,
  scaffoldAdapters,
} from "./helpers/native-adapters";

const space = adapterWorkspace();
afterEach(() => space.cleanup());
const Payload = Schema.Struct({
  tool_name: Schema.String,
  tool_input: Schema.Record(Schema.String, Schema.Unknown),
  cwd: Schema.String,
});
const shellSamples = {
  claude: Schema.decodeUnknownSync(Schema.Struct({ "PreToolUse.Bash": Payload }))(
    JSON.parse(readFileSync(join(samples, "..", "hook-input/claude-code-2026-10-26.json"), "utf8")),
  )["PreToolUse.Bash"],
  codex: JSON.parse(readFileSync(join(samples, "codex-pretooluse.json"), "utf8")),
  cursor: JSON.parse(readFileSync(join(samples, "cursor-pretooluse.json"), "utf8")),
};

function payload(
  agent: "claude" | "codex" | "cursor",
  project: string,
  input: Record<string, unknown>,
) {
  const sample = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
    shellSamples[agent],
  );
  return { ...sample, cwd: project, workspace_roots: [project], tool_input: input };
}

function expectAllowed(result: ReturnType<typeof runGuard>, agent: string) {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  if (agent === "cursor") {
    Schema.decodeUnknownSync(Schema.Struct({ permission: Schema.Literal("allow") }))(
      JSON.parse(result.stdout),
    );
  } else expect(result.stdout).toBe("");
}

test.each(["Bash", "apply_patch"])(
  "Codex allows %s with a note when its guard is missing",
  async (tool) => {
    const result = await scaffoldAdapters({ home: space.temp(), agents: ["codex"] });
    const commands = guardCommands(result.project, "codex", tool);
    expect(commands).toHaveLength(1);
    const outside = space.temp();
    const run = runGuard({
      project: outside,
      agent: "codex",
      command: commands[0] ?? "",
      payload: payload("codex", outside, { command: "git status" }),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("allowing");
  },
);

test.each(["claude", "codex", "cursor"] as const)(
  "%s dispatches its configured guard on the native payload, blocking destructive commands and allowing a near miss [3.4b#3]",
  async (agent) => {
    const result = await scaffoldAdapters({ home: space.temp(), agents: [agent] });
    const commands = guardCommands(result.project, agent, agent === "cursor" ? "Shell" : "Bash");
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      for (const nearMiss of ["git status", "git reset --soft"])
        expectAllowed(
          runGuard({
            agent,
            project: result.project,
            command,
            payload: payload(agent, result.project, {
              command: nearMiss,
              working_directory: result.project,
            }),
          }),
          agent,
        );
    }
    const blocked = commands.map((command) =>
      runGuard({
        agent,
        project: result.project,
        command,
        payload: payload(agent, result.project, {
          command: "git reset --hard",
          working_directory: result.project,
        }),
      }),
    );
    // At least one dispatched guard must deny, rather than merely listing a script in JSON.
    const denial = blocked.find((r) => r.status === 2 || r.stdout.includes('"deny"'));
    expect(denial).toBeDefined();
    if (denial) expectBlocked(denial, agent);
  },
);

test.each(["codex", "cursor"] as const)(
  "%s executes configured guards through a symlinked project path with spaces and Unicode [3.4b#5]",
  async (agent) => {
    const home = space.temp();
    const result = await scaffoldAdapters({ home, agents: [agent], name: "café project" });
    const alias = join(home, "linked café project");
    symlinkSync(result.project, alias, "dir");
    const commands = guardCommands(alias, agent, agent === "cursor" ? "Shell" : "Bash");
    expect(commands.length).toBeGreaterThan(0);
    const runs = commands.map((command) =>
      runGuard({
        agent,
        project: alias,
        command,
        payload: payload(agent, alias, { command: "git reset --hard", working_directory: alias }),
      }),
    );
    const denial = runs.find((r) => r.status === 2 || r.stdout.includes('"deny"'));
    expect(denial).toBeDefined();
    if (denial) expectBlocked(denial, agent);
  },
);

test.each(["codex", "cursor"] as const)(
  "%s blocks an escaped secret write and permits an example file [3.4b#9]",
  async (agent) => {
    const result = await scaffoldAdapters({ home: space.temp(), agents: [agent] });
    const commands = guardCommands(
      result.project,
      agent,
      agent === "codex" ? "apply_patch" : "Write",
    );
    expect(commands.length).toBeGreaterThan(0);
    const input = (file: string) => ({
      file_path: join(result.project, file),
      content: 'name="café"\npath="C:\\work"\npem="-----BEGIN PRIVATE KEY-----"\n',
    });
    const makePayload = (file: string, content = input(file).content) => {
      if (agent === "codex") {
        const patch = [
          "*** Begin Patch",
          `*** Add File: ${file}`,
          ...content
            .trimEnd()
            .split("\n")
            .map((line) => `+${line}`),
          "*** End Patch",
        ].join("\n");
        return { ...payload(agent, result.project, { command: patch }), tool_name: "apply_patch" };
      }
      return { ...payload(agent, result.project, { ...input(file), content }), tool_name: "Write" };
    };
    for (const file of [".env", ".env.local", "src/config.ts"]) {
      const runs = commands.map((command) =>
        runGuard({
          agent,
          project: result.project,
          command,
          payload: makePayload(file, file.startsWith(".env") ? "DEBUG=1\n" : input(file).content),
        }),
      );
      const denial = runs.find((r) => r.status === 2 || r.stdout.includes('"deny"'));
      expect(denial, file).toBeDefined();
      if (denial) expectBlocked(denial, agent);
    }
    for (const command of commands)
      expectAllowed(
        runGuard({ agent, project: result.project, command, payload: makePayload(".env.example") }),
        agent,
      );
    for (const command of commands)
      expectAllowed(
        runGuard({
          agent,
          project: result.project,
          command,
          payload: makePayload("src/config.ts", "export const name = 'café';\n"),
        }),
        agent,
      );
  },
);

test("OpenCode's local plugin translates tool input through a symlinked path and preserves near misses [3.4b#3] [3.4b#5] [3.4b#9]", async () => {
  const home = space.temp();
  const result = await scaffoldAdapters({ home, agents: ["opencode"], name: "café project" });
  const alias = join(home, "linked café project");
  symlinkSync(result.project, alias, "dir");
  const sample = Schema.decodeUnknownSync(
    Schema.Struct({
      input: Schema.Record(Schema.String, Schema.String),
      output: Schema.Struct({ args: Schema.Record(Schema.String, Schema.String) }),
    }),
  )(JSON.parse(readFileSync(join(samples, "opencode-before.json"), "utf8")));
  const shell = (command: string) => ({
    ...sample,
    output: { args: { command, description: "Guard test" } },
  });
  const write = (
    file: string,
    content = 'name="café"\npath="C:\\work"\npem="-----BEGIN PRIVATE KEY-----"\n',
  ) => ({
    input: { ...sample.input, tool: "write" },
    output: {
      args: {
        filePath: join(result.project, file),
        content,
      },
    },
  });
  const tmp = join(result.project, "..", "tmp");
  mkdirSync(tmp);
  const run = spawnSync("bun", [join(samples, "run-opencode.mjs"), alias], {
    cwd: alias,
    input: JSON.stringify([
      shell("git reset --hard"),
      shell("git status"),
      shell("git reset --soft"),
      write(".env", "DEBUG=1\n"),
      write(".env.local", "DEBUG=1\n"),
      write("src/config.ts"),
      write(".env.example"),
      write("src/harmless.ts", "export const value = 1;\n"),
    ]),
    env: { HOME: result.project, PATH: process.env.PATH ?? "", TMPDIR: tmp },
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(run.error).toBeUndefined();
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  const decisions = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ blocked: Schema.Boolean, reason: Schema.String })),
  )(JSON.parse(run.stdout));
  expect(decisions.map((d) => d.blocked)).toEqual([
    true,
    false,
    false,
    true,
    true,
    true,
    false,
    false,
  ]);
  for (const decision of decisions.filter((d) => d.blocked))
    expect(decision.reason).toMatch(/BLOCKED/i);
});

const harmlessAdd = "*** Add File: src/harmless.ts\n+export const value = 1;";
const secretUpdate =
  '*** Update File: src/config.ts\n@@\n-export const value = 1;\n+export const pem = "-----BEGIN PRIVATE KEY-----";';
test.each([
  { name: "source update", patch: secretUpdate, blocked: true },
  {
    name: ".env update with harmless content",
    patch: "*** Update File: .env\n@@\n-DEBUG=0\n+DEBUG=1",
    blocked: true,
  },
  {
    name: "harmless addition before a secret update",
    patch: `${harmlessAdd}\n${secretUpdate}`,
    blocked: true,
  },
  {
    name: "harmless addition before a forbidden env addition",
    patch: `${harmlessAdd}\n*** Add File: .env.local\n+DEBUG=1`,
    blocked: true,
  },
  {
    name: "harmless source update",
    patch: "*** Update File: src/config.ts\n@@\n-export const value = 1;\n+export const value = 2;",
    blocked: false,
  },
])("Codex handles $name in an apply_patch payload [3.4b#9]", async ({ patch, blocked }) => {
  const result = await scaffoldAdapters({ home: space.temp(), agents: ["codex"] });
  mkdirSync(join(result.project, "src"));
  writeFileSync(join(result.project, "src/config.ts"), "export const value = 1;\n");
  writeFileSync(join(result.project, ".env"), "DEBUG=0\n");
  const commands = guardCommands(result.project, "codex", "apply_patch");
  expect(commands.length).toBeGreaterThan(0);
  const runs = commands.map((command) =>
    runGuard({
      agent: "codex",
      project: result.project,
      command,
      payload: {
        ...payload("codex", result.project, {
          command: `*** Begin Patch\n${patch}\n*** End Patch`,
        }),
        tool_name: "apply_patch",
      },
    }),
  );
  if (!blocked) {
    for (const run of runs) expectAllowed(run, "codex");
    return;
  }
  const denial = runs.find((r) => r.status === 2 || r.stdout.includes('"deny"'));
  expect(denial).toBeDefined();
  if (denial) expectBlocked(denial, "codex");
});
