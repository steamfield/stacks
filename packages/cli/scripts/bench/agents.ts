import type { AgentId } from "@steamfield/stacks-format";
import { Result, Schema } from "effect";
import type { Effort } from "./options";

export type AgentAdapter = {
  readonly id: AgentId;
  readonly binary: string;
  readonly versionArgs: ReadonlyArray<string>;
  readonly auth: { readonly env: string; readonly obtain: string };
  /** Used when --model is absent; without one the agent picks its own default. */
  readonly defaultModel?: string;
  /** Used when --effort is absent, for an agent with `effortArgs`. */
  readonly defaultEffort?: Effort;
  readonly headlessArgs: (prompt: string, model?: string) => ReadonlyArray<string>;
  /** Present only for an agent that takes a reasoning effort; `--effort` is refused otherwise. */
  readonly effortArgs?: (effort: Effort) => ReadonlyArray<string>;
  readonly readResult: (tail: string) => {
    ended: "exit" | "error";
    subtype?: string;
    turns?: number;
  };
  /** The bench appends the absolute log path to args. */
  readonly debugLog?: { readonly env?: string; readonly args: ReadonlyArray<string> };
  readonly readHooks?: (log: string) => ReadonlyArray<string>;
};

const ClaudeResult = Schema.Struct({
  type: Schema.Literal("result"),
  is_error: Schema.Boolean,
  subtype: Schema.String,
  num_turns: Schema.Number,
});
const Json = Schema.fromJsonString(Schema.Unknown);
const CodexEvent = Schema.fromJsonString(Schema.Struct({ type: Schema.String }));
const structured = (line: string) =>
  line.trimStart().startsWith("{") || line.trimStart().startsWith("[");

/** The effort a run uses: the flag, else the agent's default; none for an agent without one. */
export function effortOf(adapter: AgentAdapter, effort: Effort | undefined): Effort | undefined {
  return adapter.effortArgs ? (effort ?? adapter.defaultEffort) : undefined;
}

// Flags checked with Claude Code 2.1.311 and codex-cli 0.164.0 help, 2026-10-27.
export const agents: readonly AgentAdapter[] = [
  {
    id: "claude",
    binary: "claude",
    versionArgs: ["--version"],
    auth: { env: "CLAUDE_CODE_OAUTH_TOKEN", obtain: "claude setup-token" },
    // The cheapest Claude model; --model overrides it for a stack that needs a stronger one.
    defaultModel: "haiku",
    headlessArgs: (prompt, model) => [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      ...(model === undefined ? [] : ["--model", model]),
    ],
    readResult: (tail) => {
      let buffer = "";
      let result: ReturnType<AgentAdapter["readResult"]> = { ended: "error" };
      for (const line of tail.split(/\r?\n/)) {
        // Processes combines the streams; diagnostics outside JSON aren't result messages.
        if (!buffer && !structured(line)) continue;
        buffer += `${line}\n`;
        const json = Schema.decodeUnknownResult(Json)(buffer);
        if (Result.isFailure(json)) continue;
        buffer = "";
        const decoded = Schema.decodeUnknownResult(ClaudeResult)(json.success);
        if (Result.isFailure(decoded)) return { ended: "error" };
        const value = decoded.success;
        result = {
          ended: !value.is_error && value.subtype === "success" ? "exit" : "error",
          subtype: value.subtype,
          turns: value.num_turns,
        };
      }
      return buffer ? { ended: "error" } : result;
    },
    debugLog: { args: ["--debug-file"] },
    readHooks: (log) =>
      [
        ...log.matchAll(
          /Hooks: \S+ \[[^\n]*?\/hooks\/([^\s"'\]]+)[^\n]*?\] finished with status \d+/g,
        ),
      ].flatMap((match) => (match[1] ? [match[1]] : [])),
  },
  {
    id: "codex",
    binary: "codex",
    versionArgs: ["--version"],
    auth: { env: "CODEX_ACCESS_TOKEN", obtain: "codex login --with-access-token" },
    // The maintainer's chosen bench setup; --model and --effort override it.
    defaultModel: "gpt-6.1-terra",
    defaultEffort: "medium",
    headlessArgs: (prompt, model) => [
      "exec",
      prompt,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      ...(model === undefined ? [] : ["--model", model]),
    ],
    // `-c` values are TOML, so the level is a quoted string.
    effortArgs: (effort) => ["-c", `model_reasoning_effort="${effort}"`],
    readResult: (tail) => {
      let ended: "exit" | "error" = "error";
      let turns = 0;
      for (const line of tail.split(/\r?\n/).filter((line) => line.trim())) {
        if (!structured(line)) continue;
        const decoded = Schema.decodeUnknownResult(CodexEvent)(line);
        if (Result.isFailure(decoded)) return { ended: "error", turns };
        switch (decoded.success.type) {
          case "turn.completed":
            turns++;
            ended = "exit";
            break;
          case "turn.started":
          case "turn.failed":
          case "error":
            ended = "error";
            break;
        }
      }
      return { ended, turns };
    },
  },
];
