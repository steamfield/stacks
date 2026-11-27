/** Native agent adapters use the composed commands, preserve decisions, and drain pipes. */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { guardCommands, samples } from "../helpers/native-adapters";
import {
  type Agent,
  agents,
  allowed,
  bashPayload,
  denied,
  fixture,
  HOOK_TEST_TIMEOUT,
  noted,
  type Run,
  run,
} from "./helpers/shipped-hooks";

vi.setConfig({ testTimeout: HOOK_TEST_TIMEOUT, hookTimeout: HOOK_TEST_TIMEOUT });
const space = fixture();
let project: string;
beforeAll(async () => {
  project = await space.scaffold();
});
afterAll(() => space.cleanup());
const Cursor = Schema.Struct({
  permission: Schema.Literals(["allow", "deny"]),
  user_message: Schema.optionalKey(Schema.String),
});
const Decisions = Schema.Array(Schema.Struct({ blocked: Schema.Boolean, reason: Schema.String }));
function shellPayload(agent: Agent, root: string, command: string, padding = "") {
  if (agent === "opencode")
    return [
      {
        input: { tool: "bash", sessionID: "wrapper-test", callID: "call" },
        output: { args: { command, description: padding } },
      },
    ];
  if (agent === "claude") return { ...bashPayload(root, command), padding };
  const sample = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
    JSON.parse(readFileSync(join(samples, `${agent}-pretooluse.json`), "utf8")),
  );
  return { ...sample, cwd: root, workspace_roots: [root], tool_input: { command }, padding };
}
function wired(
  agent: Exclude<Agent, "opencode">,
  root: string,
  tool = agent === "cursor" ? "Shell" : "Bash",
) {
  const commands = guardCommands(root, agent, tool);
  expect(commands).toHaveLength(1);
  const command = commands[0];
  if (!command) throw new Error(`No ${agent} guard`);
  return command;
}
async function invoke(agent: Agent, root: string, command: string, padding = "") {
  const payload = shellPayload(agent, root, command, padding);
  return agent === "opencode"
    ? await run(root, "", payload, {
        program: "bun",
        args: [join(samples, "run-opencode.mjs"), root],
        agent,
      })
    : await run(root, wired(agent, root), payload, { agent });
}
function allows(agent: Agent, result: Run) {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  if (agent === "cursor")
    expect(Schema.decodeUnknownSync(Cursor)(JSON.parse(result.stdout))).toEqual({
      permission: "allow",
    });
  else if (agent === "opencode")
    expect(Schema.decodeUnknownSync(Decisions)(JSON.parse(result.stdout))).toEqual([
      { blocked: false, reason: "" },
    ]);
  else allowed(result);
}
function blocks(agent: Agent, result: Run) {
  if (agent === "claude" || agent === "codex") return denied(result);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  if (agent === "cursor") {
    const decision = Schema.decodeUnknownSync(Cursor)(JSON.parse(result.stdout));
    expect(decision.permission).toBe("deny");
    return decision.user_message ?? "";
  }
  const decisions = Schema.decodeUnknownSync(Decisions)(JSON.parse(result.stdout));
  expect(decisions).toHaveLength(1);
  expect(decisions[0]?.blocked).toBe(true);
  return decisions[0]?.reason ?? "";
}
test.concurrent.each(agents)(
  "%s's composed wrapper denies destructive work and allows normal work",
  async (agent) => {
    expect(blocks(agent, await invoke(agent, project, "git reset --hard"))).toMatch(/git/);
    allows(agent, await invoke(agent, project, "git status"));
    if (agent !== "claude")
      expect(
        blocks(agent, await invoke(agent, project, "rm -rf /opt/unrelated-project")),
      ).toContain("outside");
    if (agent === "cursor") {
      const command = wired(agent, project, "Write");
      const write = (file: string, content: string) => ({
        ...shellPayload(agent, project, ""),
        tool_name: "Write",
        tool_input: { file_path: join(project, file), content },
      });
      expect(
        blocks(
          agent,
          await run(project, command, write("src/config.ts", "-----BEGIN PRIVATE KEY-----"), {
            agent,
          }),
        ),
      ).toContain("Private key");
      allows(
        agent,
        await run(project, command, write(".env.example", "-----BEGIN PRIVATE KEY-----"), {
          agent,
        }),
      );
      allows(
        agent,
        await run(project, command, write("src/config.ts", "export const value = 1;"), { agent }),
      );
    }
  },
);
test.concurrent.each(agents)("%s's wrapper allows a missing guard with one note", async (agent) => {
  const root = space.copy(project);
  rmSync(
    join(
      root,
      agent === "cursor" ? ".cursor/hooks/guard.sh" : ".claude/hooks/block-destructive.sh",
    ),
  );
  const result = await invoke(agent, root, "git reset --hard");
  const stdout = agent === "opencode" ? '[{"blocked":false,"reason":""}]' : "";
  noted(result, stdout);
});
test.concurrent.each(agents)("%s's wrapper fails open when its guard crashes", async (agent) => {
  const root = space.copy(project);
  const script =
    agent === "cursor" ? ".cursor/hooks/guard.sh" : ".claude/hooks/block-destructive.sh";
  writeFileSync(join(root, script), "echo first >&2\necho second >&2\nexit 7\n");
  noted(
    await invoke(agent, root, "git reset --hard"),
    agent === "opencode" ? '[{"blocked":false,"reason":""}]' : "",
  );
  if (agent === "opencode") {
    writeFileSync(join(root, script), "printf '{broken'\n");
    noted(await invoke(agent, root, "git reset --hard"), '[{"blocked":false,"reason":""}]');
  }
});
test.concurrent.each(agents)(
  "%s's wrapper allows a missing helper with one note",
  async (agent) => {
    const root = space.copy(project);
    rmSync(join(root, ".claude/hooks/_lib.sh"));
    let stdout = "";
    if (agent === "opencode") stdout = '[{"blocked":false,"reason":""}]';
    if (agent === "cursor") stdout = '{"permission":"allow"}\n';
    noted(await invoke(agent, root, "git reset --hard"), stdout);
  },
);

test.concurrent.each(["bash guard", "settings.json", "codex", "cursor", "opencode"] as const)(
  "%s drains more than 256 KiB on an early failure without EPIPE",
  async (shape) => {
    const root = space.copy(project);
    const padding = `${" ".repeat(1024)}\n`.repeat(1024);
    if (shape === "opencode") {
      rmSync(join(root, ".claude/hooks/_lib.sh"));
      noted(
        await invoke("opencode", root, "git status", padding),
        '[{"blocked":false,"reason":""}]',
      );
      return;
    }
    let command: string;
    if (shape === "bash guard") {
      rmSync(join(root, ".claude/hooks/_lib.sh"));
      command = 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/block-destructive.sh"';
    } else {
      const agent = shape === "settings.json" ? "claude" : shape;
      command = wired(agent, root);
      rmSync(
        join(
          root,
          agent === "cursor" ? ".cursor/hooks/guard.sh" : ".claude/hooks/block-destructive.sh",
        ),
      );
    }
    const agent = shape === "codex" || shape === "cursor" ? shape : "claude";
    noted(
      await run(
        root,
        command,
        `${JSON.stringify(shellPayload(agent, root, "git status"))}\n${padding}`,
        {
          raw: true,
          agent,
        },
      ),
    );
  },
);

// Native patch translation is a separate entry path: a Bash-only test cannot protect it.
test("Codex apply_patch checks later files in a multi-file patch and permits source edits", async () => {
  const command = wired("codex", project, "apply_patch");
  const patch = "*** Begin Patch\n*** Add File: src/normal.ts\n+export const value = 1;\n";
  expect(
    denied(
      await run(
        project,
        command,
        {
          ...bashPayload(project, `${patch}*** Add File: .env\n+DEBUG=1\n*** End Patch`),
          tool_name: "apply_patch",
        },
        { agent: "codex" },
      ),
    ),
  ).toMatch(/\.env/);
  allowed(
    await run(
      project,
      command,
      {
        ...bashPayload(project, `${patch}*** End Patch`),
        tool_name: "apply_patch",
      },
      { agent: "codex" },
    ),
  );
  const root = space.copy(project);
  rmSync(join(root, ".claude/hooks/_lib.sh"));
  noted(
    await run(
      root,
      command,
      {
        ...bashPayload(root, `${patch}*** End Patch`),
        tool_name: "apply_patch",
      },
      { agent: "codex" },
    ),
  );
  rmSync(join(root, ".codex/hooks/check-patch.sh"));
  noted(
    await run(
      root,
      command,
      {
        ...bashPayload(root, `${patch}*** End Patch`),
        tool_name: "apply_patch",
      },
      { agent: "codex" },
    ),
  );
});
test("OpenCode translates native write paths and contents into secret checks", async () => {
  const payload = (file: string) => [
    {
      input: { tool: "write", sessionID: "write-test" },
      output: { args: { filePath: join(project, file), content: "-----BEGIN PRIVATE KEY-----" } },
    },
  ];
  const options = {
    program: "bun",
    args: [join(samples, "run-opencode.mjs"), project],
    agent: "opencode",
  } as const;
  expect(blocks("opencode", await run(project, "", payload("src/config.ts"), options))).toContain(
    "Private key",
  );
  allows("opencode", await run(project, "", payload(".env.example"), options));
});
