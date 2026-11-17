import { existsSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { AGENT_MARKER_NAMES, AgentMarkers, detectAgent, type Environment } from "../src/config";
import { NewResult } from "../src/schemas/new";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { jsonResult } from "./helpers/create";
import { composeRegistry } from "./helpers/registry";
import { readManifestAt } from "./helpers/verify";

async function detected(env: Environment): Promise<string> {
  const result = jsonResult(
    await runCli(["new", "web-stack", "app", "--json"], {
      env: { ...quiet, ...env },
      host: { registry: composeRegistry },
    }),
    NewResult,
  );
  if (result.handoff.kind === "inside-agent") return result.handoff.agent;
  expect(result.handoff.reason).toBe("json");
  return "none";
}

test.each([
  ["CLAUDECODE", "1", "claude"],
  ["CLAUDE_CODE", "1", "claude"],
  ["CODEX_SANDBOX", "1", "codex"],
  ["CODEX_CI", "1", "codex"],
  ["CODEX_THREAD_ID", "1", "codex"],
  ["OPENCODE", "1", "opencode"],
  ["OPENCODE_CLIENT", "1", "opencode"],
  ["CURSOR_AGENT", "1", "cursor"],
  ["CURSOR_EXTENSION_HOST_ROLE", "agent-exec", "cursor"],
  ["AI_AGENT", "codex-cli", "codex"],
])("the %s marker is detected [1.2b#8]", async (name, value, agent) => {
  expect(await detected({ [name]: value })).toBe(agent);
});

test("AI_AGENT names a known agent by prefix; any other value is other; no marker is none [1.2b#8]", async () => {
  expect(await detected({ AI_AGENT: "claude-code" })).toBe("claude");
  expect(await detected({ AI_AGENT: "Cursor Agent" })).toBe("cursor");
  expect(await detected({ AI_AGENT: "foo" })).toBe("other");
  expect(await detected({})).toBe("none");
});

test("blank markers and the wrong Cursor host role don't count", () => {
  expect(detectAgent({ CLAUDECODE: "", AI_AGENT: "" })).toBe("none");
  expect(detectAgent({ CURSOR_EXTENSION_HOST_ROLE: "user" })).toBe("none");
  expect(detectAgent({ CURSOR_TRACE_ID: "abc" })).toBe("none");
});

test("markers are checked in table order", () => {
  expect(detectAgent({ AI_AGENT: "foo", CODEX_CI: "1", CLAUDECODE: "1" })).toBe("claude");
  expect(detectAgent({ AI_AGENT: "foo", OPENCODE: "1" })).toBe("opencode");
});

test("the strip list holds every marker name, AI_AGENT included, once each", () => {
  expect(new Set(AGENT_MARKER_NAMES)).toEqual(new Set(AgentMarkers.map((m) => m.name)));
  expect(AGENT_MARKER_NAMES).toContain("AI_AGENT");
  expect(AGENT_MARKER_NAMES.length).toBe(new Set(AGENT_MARKER_NAMES).size);
});

const markerName = Schema.Literals(AGENT_MARKER_NAMES as [string, ...string[]]);
const other = Schema.Record(
  Schema.String.check(Schema.isPattern(/^[a-z][a-z_]*$/, { expected: "a lowercase name" })),
  Schema.String,
);
it.prop(
  "any environment holding a marker with a non-empty value detects an agent [1.2b#8]",
  [markerName, Schema.String.check(Schema.isMinLength(1)), other],
  ([name, value, rest]) => {
    const env = { ...rest, [name]: name === "CURSOR_EXTENSION_HOST_ROLE" ? "agent-exec" : value };
    expect(detectAgent(env)).not.toBe("none");
  },
);

test("a detected agent doesn't change the target agents or the manifest's agents [1.2b#9]", async () => {
  const dir = tempDir();
  try {
    const result = jsonResult(
      await runCli(["new", "web-stack", "app", "--json"], {
        home: dir.path,
        env: { ...quiet, CODEX_THREAD_ID: "thread-1" },
        host: { registry: composeRegistry },
      }),
      NewResult,
    );
    expect(result.handoff).toMatchObject({ kind: "inside-agent", agent: "codex" });
    expect(result.agents).toEqual(["claude"]);
    expect(readManifestAt(result.project).agents).toEqual(["claude"]);
    expect(result.written).toContain(".claude/settings.json");
    expect(result.written).not.toContain(".codex/config.toml");
    expect(existsSync(join(result.project, ".claude/settings.json"))).toBe(true);
    expect(existsSync(join(result.project, ".codex/config.toml"))).toBe(false);
  } finally {
    dir.cleanup();
  }
});
