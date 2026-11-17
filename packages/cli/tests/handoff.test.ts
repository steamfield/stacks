import { it } from "@effect/vitest";
import { AgentId, DetectedAgent, Harness } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";
import { decideHandoff, type HandoffInput } from "../src/core/handoff/decide";
import { LAUNCH_ARGS } from "../src/core/handoff/launchers";
import { agentPrompt, renderHandoff } from "../src/core/handoff/render";

const prompt = agentPrompt("stacks");
const base: HandoffInput = {
  detected: "none",
  json: false,
  launch: true,
  stdinIsTTY: true,
  stdoutIsTTY: true,
  untrusted: [],
  configured: [],
  found: new Map([["claude", "/bin/claude"]]),
  prompt,
};
const decide = (overrides: Partial<HandoffInput>) => decideHandoff({ ...base, ...overrides });

describe("decideHandoff, first matching rule wins [1.4#1]", () => {
  test.each<[string, Partial<HandoffInput>, ReturnType<typeof decideHandoff>]>([
    [
      "a detected agent",
      { detected: "codex" },
      { kind: "inside-agent", agent: "codex", untrusted: [] },
    ],
    [
      "an unrecognized agent counts as detected",
      { detected: "other" },
      { kind: "inside-agent", agent: "other", untrusted: [] },
    ],
    [
      "a detected agent beats --json",
      { detected: "claude", json: true, untrusted: ["x"] },
      { kind: "inside-agent", agent: "claude", untrusted: ["x"] },
    ],
    ["--json", { json: true }, { kind: "print", reason: "json", untrusted: [] }],
    [
      "--json beats --no-launch",
      { json: true, launch: false },
      { kind: "print", reason: "json", untrusted: [] },
    ],
    ["--no-launch", { launch: false }, { kind: "print", reason: "no-launch", untrusted: [] }],
    [
      "--no-launch beats no terminal",
      { launch: false, stdinIsTTY: false },
      { kind: "print", reason: "no-launch", untrusted: [] },
    ],
    [
      "stdin not a terminal",
      { stdinIsTTY: false },
      { kind: "print", reason: "not-a-terminal", untrusted: [] },
    ],
    [
      "stdout not a terminal",
      { stdoutIsTTY: false },
      { kind: "print", reason: "not-a-terminal", untrusted: [] },
    ],
    [
      "no terminal beats untrusted",
      { stdoutIsTTY: false, untrusted: ["local"] },
      { kind: "print", reason: "not-a-terminal", untrusted: ["local"] },
    ],
    [
      "untrusted beats a found binary",
      { untrusted: ["local"] },
      { kind: "print", reason: "untrusted", untrusted: ["local"] },
    ],
    [
      "the only agent found",
      {},
      { kind: "launch", agent: "claude", via: "terminal", bin: "/bin/claude", args: [prompt] },
    ],
    [
      "configured agents come first",
      {
        configured: ["opencode"],
        found: new Map([
          ["claude", "/bin/claude"],
          ["opencode", "/bin/opencode"],
        ]),
      },
      {
        kind: "launch",
        agent: "opencode",
        via: "terminal",
        bin: "/bin/opencode",
        args: ["--prompt", prompt],
      },
    ],
    [
      "several found and none configured: choose, in the default order (4.4c)",
      {
        configured: ["cursor"],
        found: new Map([
          ["codex", "/bin/codex"],
          ["claude", "/bin/claude"],
        ]),
      },
      {
        kind: "choose",
        options: [
          { kind: "launch", agent: "claude", via: "terminal", bin: "/bin/claude", args: [prompt] },
          { kind: "launch", agent: "codex", via: "terminal", bin: "/bin/codex", args: [prompt] },
        ],
        untrusted: [],
      },
    ],
    [
      "--launch is tried alone",
      { preferred: "codex", configured: ["claude"] },
      { kind: "print", reason: "agent-not-found", agent: "codex", untrusted: [] },
    ],
    [
      "--launch found",
      { preferred: "cursor", found: new Map([["cursor", "/bin/cursor-agent"]]) },
      {
        kind: "launch",
        agent: "cursor",
        via: "terminal",
        bin: "/bin/cursor-agent",
        args: [prompt],
      },
    ],
    [
      "nothing on PATH",
      { found: new Map() },
      { kind: "print", reason: "no-agent-found", untrusted: [] },
    ],
  ])("%s", (_, overrides, expected) => {
    expect(decide(overrides)).toEqual(expected);
  });
});

const input = Schema.Struct({
  detected: DetectedAgent,
  json: Schema.Boolean,
  launch: Schema.Boolean,
  stdinIsTTY: Schema.Boolean,
  stdoutIsTTY: Schema.Boolean,
  untrusted: Schema.Array(Schema.String),
  preferred: Schema.optionalKey(AgentId),
  configured: Schema.Array(AgentId),
  found: Schema.Array(AgentId),
});
const run = (value: typeof input.Type) =>
  decideHandoff({
    ...value,
    found: new Map(value.found.map((agent) => [agent, `/bin/${agent}`])),
    prompt,
  });
it.prop("an untrusted entry never reaches launch [1.4#2]", [input], ([value]) => {
  if (value.untrusted.length) expect(run(value).kind).not.toBe("launch");
});
it.prop("a detected agent is always inside-agent [1.4#2]", [input], ([value]) => {
  if (value.detected !== "none")
    expect(run(value)).toEqual({
      kind: "inside-agent",
      agent: value.detected,
      untrusted: value.untrusted,
    });
});

test("every harness has a launch row [1.4#1]", () => {
  expect(Object.keys(LAUNCH_ARGS).sort()).toEqual([...Harness.literals].sort());
  const { opencode, cursor } = LAUNCH_ARGS;
  expect(opencode.via === "terminal" && opencode.args("p")).toEqual(["--prompt", "p"]);
  expect(cursor.via === "terminal" && cursor.bin).toBe("cursor-agent");
});

test("the prompt names the invocation, so an npx project names the pinned version [1.4#10]", () => {
  expect(agentPrompt("npx -y stacks@1.2.3")).toBe(
    "Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when npx -y stacks@1.2.3 verify passes.",
  );
  const text = renderHandoff(
    { kind: "print", reason: "no-launch", untrusted: [] },
    { shown: "app", invocation: "npx -y stacks@1.2.3", audience: "human", agent: "claude" },
  );
  expect(text).toContain("npx -y stacks@1.2.3 verify passes.");
  const inside = renderHandoff(
    { kind: "inside-agent", agent: "claude", untrusted: [] },
    { shown: "app", invocation: "npx -y stacks@1.2.3", audience: "agent", agent: "claude" },
  );
  expect(inside).toContain("Loop on npx -y stacks@1.2.3 verify until it passes.");
});

test("the printed example quotes a directory with spaces and quotes so it pastes into a shell [1.4#19]", () => {
  const text = renderHandoff(
    { kind: "print", reason: "no-launch", agent: "opencode", untrusted: [] },
    { shown: "my 'app'", invocation: "stacks", audience: "human", agent: "claude" },
  );
  expect(text.split("\n").at(-1)).toBe(
    `For example: cd 'my '\\''app'\\''' && opencode --prompt "${prompt}"`,
  );
  const here = renderHandoff(
    { kind: "print", reason: "no-launch", untrusted: [] },
    { shown: ".", invocation: "stacks", audience: "human", agent: "claude" },
  );
  expect(here.split("\n").at(-1)).toBe(`For example: claude "${prompt}"`);
});
