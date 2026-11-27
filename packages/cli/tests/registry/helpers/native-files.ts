import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentId } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { parse } from "smol-toml";
import { expect } from "vitest";
import { parse as parseYaml } from "yaml";
import type { scaffoldAdapters } from "../../helpers/native-adapters";

const configs = {
  claude: ".claude/settings.json",
  codex: ".codex/hooks.json",
  opencode: "opencode.json",
  cursor: ".cursor/hooks.json",
};
const Hook = Schema.Struct({ command: Schema.String });
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

export function instructionMetadata(file: string) {
  const text = readFileSync(file, "utf8");
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  expect(header, `${file} frontmatter`).not.toBeNull();
  const value: unknown = parseYaml(header?.[1] ?? "");
  expect(text.slice(header?.[0].length ?? 0).trim()).not.toBe("");
  return Schema.decodeUnknownSync(JsonObject)(value);
}

export function checkNativeFiles(result: Awaited<ReturnType<typeof scaffoldAdapters>>) {
  for (const agent of AgentId.literals) {
    expect(result.written.includes(configs[agent]), `${agent} config`).toBe(
      result.agents.includes(agent),
    );
    if (result.agents.includes(agent)) {
      Schema.decodeUnknownSync(JsonObject)(
        JSON.parse(readFileSync(join(result.project, configs[agent]), "utf8")),
      );
    }
  }
  if (!result.agents.includes("codex")) expect(result.written).not.toContain(".codex/config.toml");
  if (!result.agents.includes("claude")) expect(result.written).not.toContain("CLAUDE.md");
  if (result.agents.includes("codex")) {
    const config = parse(readFileSync(join(result.project, ".codex/config.toml"), "utf8"));
    expect(config.sandbox_mode).toBe("workspace-write");
    expect(config.approval_policy).toBe("on-request");
  }
  if (result.agents.includes("opencode")) {
    expect(result.written.some((f) => /^\.opencode\/plugins\/.*\.[cm]?[jt]s$/.test(f))).toBe(true);
  }
  if (result.agents.includes("cursor")) {
    const rules = result.written.filter((f) => /^\.cursor\/rules\/.*\.mdc$/.test(f));
    expect(rules.length).toBeGreaterThan(0);
    expect(
      rules.some((f) => instructionMetadata(join(result.project, f)).alwaysApply === true),
    ).toBe(true);
    const hooks = Schema.decodeUnknownSync(
      Schema.Struct({
        version: Schema.Literal(1),
        hooks: Schema.Record(Schema.String, Schema.Array(Hook)),
      }),
    )(JSON.parse(readFileSync(join(result.project, ".cursor/hooks.json"), "utf8")));
    expect(hooks.hooks.preToolUse?.length).toBeGreaterThan(0);
  }
}
