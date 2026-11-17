/** Parses the project flags shared by `new` and `add`. */
import { AgentId, Harness } from "@steamfield/stacks-format";
import { Effect, Option, Schema } from "effect";
import { CliError, Flag } from "effect/cli";
import { replayFlags } from "../core/prompting";

/** Splits repeatable, comma-separated flag values into trimmed, nonempty items. */
export const splitValues = (values: ReadonlyArray<string>) =>
  values.flatMap((value) => value.split(",").map((part) => part.trim())).filter(Boolean);

const isAgent = Schema.is(AgentId);
const isHarness = Schema.is(Harness);

const agentValue = (option: string, value: string) =>
  isAgent(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new CliError.InvalidValue({
          option,
          value,
          expected: "claude, codex, opencode or cursor",
          kind: "flag",
        }),
      );

const harnessValue = (value: string) =>
  isHarness(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new CliError.InvalidValue({
          option: "launch",
          value,
          expected: Harness.literals.join(", "),
          kind: "flag",
        }),
      );

/** Shared flags, with help reflecting the two commands' different sandbox semantics. */
export const projectFlags = (command: "new" | "add") => ({
  sandbox: Flag.Boolean("sandbox").pipe(
    Flag.withDescription(
      command === "new"
        ? "Local only: every default, no deploy, release or app fragments unless named with --with, steps tagged prod skipped. Implies --yes."
        : "Use the sandbox preset when creating a manifest. Existing projects keep their preset. Implies --yes.",
    ),
    Flag.withDefault(false),
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withDescription(
      "Take every decision's default: the brief tells the agent not to ask you.",
    ),
    Flag.withDefault(false),
  ),
  agents: Flag.String("agents").pipe(
    Flag.withDescription(
      "Agents to write adapter files for: claude, codex, opencode, cursor. Repeatable or comma-separated. Default: the agents setting, else claude.",
    ),
    Flag.atLeast(0),
    Flag.mapEffect((values) =>
      Effect.forEach(splitValues(values), (value) => agentValue("agents", value)),
    ),
    Flag.map((agents) => (agents.length ? agents : undefined)),
  ),
  launch: Flag.String("launch").pipe(
    Flag.withDescription(
      `The harness to hand the project to: claude, codex, opencode, cursor, copilot or codex-app (macOS). Default: the first configured agent on PATH; otherwise one found harness launches, and a person with several agents and none configured is asked. ${command === "new" ? "Never with --json, --no-launch or --dry-run." : "Never with --json or --no-launch."}`,
    ),
    Flag.mapEffect(harnessValue),
    Flag.optional,
  ),
  noLaunch: Flag.Boolean("no-launch").pipe(
    Flag.withDescription(
      "Don't start an agent; print the prompt to give one. Otherwise a person with several agents and none configured is asked. --json, a detected agent session or a non-terminal never starts one either.",
    ),
    Flag.withDefault(false),
  ),
});

/** Extra and missing parsed keys fail typecheck, including optional core options. */
export type ExactProjectOptions<Parsed, Options> = Options &
  Record<Exclude<keyof Parsed, keyof Options> | Exclude<keyof Options, keyof Parsed>, never>;

type ReplayValue = Parameters<typeof replayFlags>[0][string];

/** Uses the table's insertion order for replay. A null name omits the parameter. */
export function replayProjectFlags<Key extends string>(
  names: Readonly<Record<Key, string | null>>,
  flags: Readonly<Record<Key, ReplayValue | Option.Option<ReplayValue>>>,
) {
  const selected: Record<string, ReplayValue> = {};
  for (const key in names) {
    const name = names[key];
    if (name === null) continue;
    const value = flags[key];
    selected[name] = isReplayOption(value) ? Option.getOrUndefined(value) : value;
  }
  return replayFlags(selected);
}

function isReplayOption(
  value: ReplayValue | Option.Option<ReplayValue>,
): value is Option.Option<ReplayValue> {
  return Option.isOption(value);
}
