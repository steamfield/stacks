import { AgentId, Harness } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Schema, Terminal } from "effect";
import { CliError, Flag } from "effect/cli";
import { AppConfig } from "../config";
import {
  agentPrompt,
  candidates,
  decideHandoff,
  type HandoffDecision,
  handoffRecord,
  LAUNCH_ARGS,
  pickerQuestion,
  pickerText,
  renderHandoff,
} from "../core/handoff";
import { encodeManifest, MANIFEST_PATH, readManifest } from "../core/manifest";
import { displayPicker } from "../core/prompting";
import { openProject } from "../core/scaffold/write";
import { shownPath } from "../core/shown-path";
import { printable } from "../core/text";
import { Interrupted, PermissionDenied, Usage } from "../errors";
import type { NewResult } from "../schemas/new";
import { Host } from "../services/host";
import { Invocation } from "../services/invocation";
import { type Audience, Output } from "../services/output";
import { Processes } from "../services/processes";

export const splitValues = (values: ReadonlyArray<string>) =>
  values.flatMap((value) => value.split(",").map((part) => part.trim())).filter(Boolean);
const isAgent = Schema.is(AgentId);
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
  Schema.is(Harness)(value)
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

/** Validate preferences and capture the inputs used when composition supplies its trust marks. */
export const prepareHandoff = (
  flags: { launch: Option.Option<Harness>; noLaunch: boolean; dryRun?: boolean },
  json: boolean,
) =>
  Effect.gen(function* () {
    const preferred = Option.getOrUndefined(flags.launch);
    yield* validatePreferences(flags, json);
    const host = yield* Host;
    const config = yield* AppConfig;
    const detected = yield* config.agent;
    const configured = (yield* config.get).agents ?? [];
    const launch = !flags.noLaunch && !flags.dryRun;
    const found =
      detected === "none" && !json && launch
        ? yield* findHarnesses(candidates(preferred, configured))
        : new Map<Harness, string>();
    return (untrusted: ReadonlyArray<string>): HandoffDecision =>
      flags.dryRun
        ? { kind: "print", reason: "no-launch", untrusted }
        : decideHandoff({
            detected,
            json,
            launch,
            stdinIsTTY: host.stdinIsTTY,
            stdoutIsTTY: host.stdoutIsTTY,
            untrusted,
            ...(preferred ? { preferred } : {}),
            configured,
            found,
            prompt: agentPrompt(host.invocation),
          });
  });

const findHarnesses = Effect.fn("handoff.findHarnesses")(function* (
  agents: ReadonlyArray<Harness>,
) {
  const processes = yield* Processes;
  const found = new Map<Harness, string>();
  for (const agent of agents) {
    const launcher = LAUNCH_ARGS[agent];
    const bin = yield* launcher.via === "terminal"
      ? processes.which(launcher.bin)
      : findApp(launcher.app);
    if (Option.isSome(bin)) found.set(agent, bin.value);
  }
  return found;
});

const findApp = Effect.fn("handoff.findApp")(function* (app: string) {
  const host = yield* Host;
  if (host.platform !== "darwin") return Option.none<string>();
  const processes = yield* Processes;
  if (Option.isNone(yield* processes.which("open"))) return Option.none<string>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths = yield* (yield* AppConfig).paths;
  for (const file of [path.join("/Applications", app), path.join(paths.home, "Applications", app)])
    if (yield* fs.exists(file)) return Option.some(file);
  return Option.none<string>();
});

const recordHandoff = (project: string, decision: HandoffDecision) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const manifest = yield* readManifest(path.join(project, MANIFEST_PATH));
      if (!manifest.handoff) return;
      const writer = yield* openProject(project);
      yield* writer.rewrite(
        MANIFEST_PATH,
        new TextEncoder().encode(
          encodeManifest({
            ...manifest,
            handoff: handoffRecord(decision, manifest.handoff.at),
          }),
        ),
      );
    }),
  );

export type SummaryContext = {
  shown: string;
  audience: Audience;
  untrusted: NewResult["untrusted"];
};

const chooseHarness = Effect.fn("handoff.chooseHarness")(function* (
  decision: Extract<HandoffDecision, { kind: "choose" }>,
) {
  const terminal = yield* Terminal.Terminal;
  yield* displayPicker(terminal, `\n${pickerText(decision.options.map((option) => option.agent))}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    yield* displayPicker(terminal, pickerQuestion(decision.options.length));
    const answer = yield* terminal.readLine.pipe(
      Effect.map(Option.some),
      Effect.catchTag("QuitError", () => Effect.succeed(Option.none<string>())),
      Effect.mapError(() => new Interrupted()),
    );
    if (Option.isNone(answer)) break;
    const value = answer.value.trim();
    if (value !== "" && !/^[1-9]\d*$/.test(value)) continue;
    const selected = decision.options[value === "" ? 0 : Number(value) - 1];
    if (selected) return selected;
  }
  return {
    kind: "print",
    reason: "not-chosen",
    untrusted: decision.untrusted,
  } satisfies HandoffDecision;
});

const launchTerminal = Effect.fn("handoff.launchTerminal")(function* (
  decision: Extract<HandoffDecision, { kind: "launch"; via: "terminal" }>,
  project: string,
) {
  const config = yield* AppConfig;
  const processes = yield* Processes;
  const status = yield* processes
    .interactive({
      bin: decision.bin,
      args: [...decision.args],
      cwd: project,
      env: config.childEnv([]),
    })
    .pipe(
      Effect.catchTag("SpawnFailed", (failure) =>
        Effect.andThen(
          recordHandoff(project, {
            kind: "print",
            reason: "not-chosen",
            untrusted: [],
          }).pipe(Effect.ignore),
          failure.errno === "EACCES"
            ? Effect.fail(
                new PermissionDenied({ details: { reason: "launch", path: decision.bin } }),
              )
            : Effect.die(failure),
        ),
      ),
    );
  yield* (yield* Invocation).exitWith(status);
});

const recordAppFallback = Effect.fn("handoff.recordAppFallback")(function* (
  project: string,
  decision: HandoffDecision,
) {
  const invocation = yield* Invocation;
  const before = yield* invocation.rollbackCount;
  yield* recordHandoff(project, decision).pipe(
    Effect.catch((failure) =>
      invocation.rollbackCount.pipe(
        Effect.flatMap((after) => (after > before ? Effect.fail(failure) : Effect.void)),
      ),
    ),
  );
});

const launchApp = Effect.fn("handoff.launchApp")(function* (
  project: string,
  context: Parameters<typeof renderHandoff>[1],
) {
  const config = yield* AppConfig;
  const processes = yield* Processes;
  const result = yield* processes
    .exec({
      argv: ["open", LAUNCH_ARGS["codex-app"].url(project, agentPrompt(context.invocation))],
      cwd: project,
      env: config.childEnv([]),
    })
    .pipe(
      Effect.map((result) => result.exitCode === 0),
      Effect.catchTag("SpawnFailed", () => Effect.succeed(false)),
    );
  if (result) return;
  const printed = { kind: "print", reason: "not-chosen", untrusted: [] } satisfies HandoffDecision;
  yield* recordAppFallback(project, printed);
  yield* (yield* Output).result(null, renderHandoff(printed, context));
});

const resolveChoice = Effect.fn("handoff.resolveChoice")(function* (
  decision: HandoffDecision,
  project: string,
  summary: string,
) {
  if (decision.kind !== "choose") return decision;
  const output = yield* Output;
  yield* output.result(null, summary);
  yield* output.flushNow;
  const selected = yield* chooseHarness(decision);
  const terminal = yield* Terminal.Terminal;
  yield* displayPicker(terminal, "\n");
  yield* recordHandoff(project, selected);
  return selected;
});

const summaryTrust = Effect.fn("handoff.summaryTrust")(function* (
  untrusted: NewResult["untrusted"],
) {
  const output = yield* Output;
  const host = yield* Host;
  if (output.audience !== "agent") return untrusted;
  return yield* Effect.forEach(untrusted, (entry) =>
    Effect.map(shownPath(host.cwd, entry.dir), (dir) => ({ ...entry, dir })),
  );
});

const launchText = (decision: Extract<HandoffDecision, { kind: "launch" }>, shown: string) =>
  decision.via === "app"
    ? `Opening the Codex app on ${printable(shown)}...`
    : `Launching ${printable(decision.bin)} in ${printable(shown)}...`;

/** Render the result, then print the next task or give the terminal to the selected agent. */
export const completeHandoff = (input: {
  project: string;
  agent: AgentId | undefined;
  untrusted: NewResult["untrusted"];
  decision: HandoffDecision;
  preview?: boolean;
  render: (context: SummaryContext) => string;
  encode: (handoff: NewResult["handoff"]) => unknown;
  beforeHandoff?: (decision: HandoffDecision) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const output = yield* Output;
    const shown = yield* shownPath(host.cwd, input.project);
    const untrusted = yield* summaryTrust(input.untrusted);
    const summary = input.render({ shown, audience: output.audience, untrusted });
    const choosing = input.decision.kind === "choose";
    const decision = yield* resolveChoice(input.decision, input.project, summary);
    if (input.beforeHandoff) yield* input.beforeHandoff(decision);
    const invocation = yield* Invocation;
    yield* invocation.annotate({
      handoff: decision.kind,
      ...(decision.kind === "print" ? {} : { agent: decision.agent }),
    });
    const context = {
      shown,
      invocation: host.invocation,
      audience: output.audience,
      agent: input.agent,
      style: output.style,
    };
    const prefix = choosing ? "" : `${summary}\n\n`;
    if (decision.kind !== "launch") {
      yield* output.result(
        input.encode({
          ...decision,
          untrusted: [...decision.untrusted],
          prompt: agentPrompt(host.invocation),
        }),
        input.preview ? summary : `${prefix}${renderHandoff(decision, context)}`,
      );
      return;
    }
    yield* output.result(null, `${prefix}${launchText(decision, shown)}`);
    yield* output.flushNow;
    if (decision.via === "app") yield* launchApp(input.project, context);
    else yield* launchTerminal(decision, input.project);
  });

function validatePreferences(
  flags: { launch: Option.Option<Harness>; noLaunch: boolean; dryRun?: boolean },
  json: boolean,
) {
  return Effect.gen(function* () {
    const preferred = Option.getOrUndefined(flags.launch);
    if (preferred && flags.dryRun)
      return yield* new Usage({ details: { flags: ["--dry-run", "--launch"] } });
    if (preferred && flags.noLaunch)
      return yield* new Usage({ details: { flags: ["--launch", "--no-launch"] } });
    if (preferred && json) return yield* new Usage({ details: { flags: ["--launch", "--json"] } });
  });
}
