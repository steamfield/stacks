import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, matchesGlob, normalize } from "node:path";
import { AgentId } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { parse } from "smol-toml";
import { afterEach, expect, test } from "vitest";
import { adapterWorkspace, nativeAgents, scaffoldAdapters } from "../helpers/native-adapters";
import { bundled } from "./helpers/bundled";
import { checkNativeFiles, instructionMetadata } from "./helpers/native-files";

const space = adapterWorkspace();
afterEach(() => space.cleanup());
const stacks = readdirSync(join(bundled, "stacks"))
  .filter((id) => existsSync(join(bundled, "stacks", id, "STACK.md")))
  .sort();
test.each(["openrouter-chat", "openrouter-chat-cli"])(
  "Cursor requests the long %s rule by description",
  (fragment) => {
    const meta = instructionMetadata(
      join(bundled, "fragments", fragment, "adapters/cursor/.cursor/rules", `${fragment}.mdc.tmpl`),
    );
    expect(meta.alwaysApply).toBe(false);
    expect(meta.description).toEqual(expect.stringMatching(/\S/));
  },
);

function readInstruction(file: string) {
  if (basename(file) === "SKILL.md") {
    const meta = Schema.decodeUnknownSync(
      Schema.Struct({
        name: Schema.NonEmptyString,
        description: Schema.NonEmptyString,
      }),
    )(instructionMetadata(file));
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(meta.name).toBe(basename(dirname(file)));
    expect(meta.description.length).toBeLessThanOrEqual(1024);
  }
  if (file.endsWith(".mdc")) {
    const meta = Schema.decodeUnknownSync(
      Schema.Struct({
        alwaysApply: Schema.optionalKey(Schema.Boolean),
        description: Schema.optionalKey(Schema.String),
        globs: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
      }),
    )(instructionMetadata(file));
    expect(
      meta.alwaysApply === true || Boolean(meta.description?.trim()) || Boolean(meta.globs?.length),
    ).toBe(true);
  }
  return readFileSync(file, "utf8");
}

function configuredInstructions(
  result: Awaited<ReturnType<typeof scaffoldAdapters>>,
  agent: string,
) {
  if (agent === "codex") {
    const path = join(result.project, ".codex/config.toml");
    if (!existsSync(path)) return [];
    const config = parse(readFileSync(path, "utf8"));
    return typeof config.model_instructions_file === "string"
      ? [normalize(join(".codex", config.model_instructions_file))]
      : [];
  }
  if (agent !== "opencode") return [];
  const path = join(result.project, "opencode.json");
  if (!existsSync(path)) return [];
  return (
    Schema.decodeUnknownSync(
      Schema.Struct({ instructions: Schema.optionalKey(Schema.Array(Schema.String)) }),
    )(JSON.parse(readFileSync(path, "utf8"))).instructions ?? []
  );
}

test.each(stacks.flatMap((stack) => AgentId.literals.map((agent) => ({ stack, agent }))))(
  "$stack writes only the selected $agent adapter [3.4b#1]",
  async ({ stack, agent }) => {
    const result = await scaffoldAdapters({
      registry: bundled,
      home: space.temp(),
      stack,
      agents: [agent],
    });
    expect(result.agents).toEqual([agent]);
    for (const file of result.written)
      expect(existsSync(join(result.project, file)), file).toBe(true);
    checkNativeFiles(result);
  },
  // Each case composes a real bundled stack and initializes git; no builds or agents run.
  15_000,
);

test.each(stacks)(
  "%s composes Claude and Codex together without losing either config [3.4b#1]",
  async (stack) => {
    const result = await scaffoldAdapters({
      registry: bundled,
      home: space.temp(),
      stack,
      agents: ["claude", "codex"],
    });
    expect(result.agents).toEqual(["claude", "codex"]);
    expect(new Set(result.written).size).toBe(result.written.length);
    checkNativeFiles(result);
  },
  15_000,
);

test.each(
  [
    { fragment: "effect", stack: "typescript-cli", token: "Effect" },
    { fragment: "bun-release", stack: "typescript-cli", token: "SHA256SUMS" },
    { fragment: "rr", stack: "go-cli", token: "rr test" },
    { fragment: "openrouter-chat", stack: "react-router", token: "OpenRouter" },
    { fragment: "openrouter-chat-cli", stack: "typescript-cli", token: "OpenRouter" },
  ].flatMap((row) => nativeAgents.map((agent) => ({ ...row, agent }))),
)(
  "$fragment supplies $agent-readable guidance in a documented instruction file [3.4b#1]",
  async ({ fragment, stack, token, agent }) => {
    const result = await scaffoldAdapters({
      registry: bundled,
      home: space.temp(),
      stack,
      fragments: [fragment],
      agents: [agent],
    });
    const configured = configuredInstructions(result, agent);
    const instructionFiles = result.written.filter((f) => {
      if (configured.some((pattern) => matchesGlob(f, pattern))) return true;
      if (agent === "cursor") return /^\.cursor\/rules\/.*\.mdc$/.test(f);
      if (agent === "codex")
        return /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(f) || f === "AGENTS.md";
      return /^\.(?:opencode|agents)\/skills\/[^/]+\/SKILL\.md$/.test(f) || f === "AGENTS.md";
    });
    // The brief is deliberately excluded: it is not automatically loaded by these agents.
    const guidance = instructionFiles
      .map((f) => readInstruction(join(result.project, f)))
      .join("\n");
    expect(guidance).toContain(token);
    expect(result.written).not.toContain(".claude/settings.json");
  },
  15_000,
);
