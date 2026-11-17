/** Discovers installed harnesses and carries out the handoff. */
import type { AgentId, Harness } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Terminal } from "effect";
import { AppConfig } from "../../config";
import { Interrupted, PermissionDenied, Usage } from "../../errors";
import type { NewResult } from "../../schemas/new";
import { Host } from "../../services/host";
import { Invocation } from "../../services/invocation";
import { type Audience, Output } from "../../services/output";
import { Processes } from "../../services/processes";
import { encodeManifest, MANIFEST_PATH, readManifest } from "../project/manifest";
import { openProject } from "../project/writer";
import { displayPicker } from "../prompting";
import { shownPath } from "../shown-path";
import { printable } from "../text";
import { candidates, decideHandoff, type HandoffDecision, handoffRecord } from "./decide";
import { LAUNCH_ARGS } from "./launchers";
import { agentPrompt, pickerQuestion, pickerText, renderHandoff } from "./render";

/** The handoff preferences a command parsed; only `new` has `--dry-run`. */
type HandoffFlags = { launch: Option.Option<Harness>; noLaunch: boolean; dryRun?: boolean };

/**
 * Validates the handoff flags and gathers what the decision needs (the detected agent, the
 * configured agents and the harnesses found on this machine). Returns the decision as a function
 * of the untrusted entry ids, because only composition knows them, and the decision has to exist
 * before anything is written so the manifest can record it.
 */
export const prepareHandoff = (flags: HandoffFlags, json: boolean) =>
  Effect.gen(function* () {
    const preferred = Option.getOrUndefined(flags.launch);
    yield* validatePreferences(flags, json);
    const host = yield* Host;
    const config = yield* AppConfig;
    const detected = yield* config.agent;
    const configured = (yield* config.get).agents ?? [];
    const launch = !flags.noLaunch && !flags.dryRun;
    // Searching PATH is only worth it when a launch is possible at all.
    const found =
      detected === "none" && !json && launch
        ? yield* findHarnesses(candidates(preferred, configured))
        : new Map<Harness, string>();
    return (untrusted: ReadonlyArray<string>): HandoffDecision => {
      if (flags.dryRun) return { kind: "print", reason: "no-launch", untrusted };
      return decideHandoff({
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
    };
  });

/** Rejects `--launch` alongside a flag that rules a launch out. */
function validatePreferences(flags: HandoffFlags, json: boolean) {
  return Effect.gen(function* () {
    const preferred = Option.getOrUndefined(flags.launch);
    if (preferred && flags.dryRun)
      return yield* new Usage({ details: { flags: ["--dry-run", "--launch"] } });
    if (preferred && flags.noLaunch)
      return yield* new Usage({ details: { flags: ["--launch", "--no-launch"] } });
    if (preferred && json) return yield* new Usage({ details: { flags: ["--launch", "--json"] } });
  });
}

/** Each candidate harness that is installed, with its binary or app path, in candidate order. */
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

/** A macOS app bundle in the system or user Applications folder, when `open` can start it. */
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

/**
 * Rewrites the manifest's handoff record when the handoff turned out differently from the one
 * written with the project. A manifest without a handoff record is left alone.
 */
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

/** The handoff recorded when a launch failed, or a person chose no agent. */
const notLaunched = {
  kind: "print",
  reason: "not-chosen",
  untrusted: [],
} satisfies HandoffDecision;

type ChooseDecision = Extract<HandoffDecision, { kind: "choose" }>;

/**
 * The option a picker answer selects: blank takes the first, a listed number its option.
 * Anything else selects nothing.
 */
function selectedOption(options: ChooseDecision["options"], answer: string) {
  const value = answer.trim();
  if (value === "") return options[0];
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  return options[Number(value) - 1];
}

/**
 * Asks a person which found harness to launch, allowing one retry after an answer that selects
 * nothing. End of input, or a second miss, prints the prompt instead.
 */
const chooseHarness = Effect.fn("handoff.chooseHarness")(function* (decision: ChooseDecision) {
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
    const selected = selectedOption(decision.options, answer.value);
    if (selected) return selected;
  }
  return { ...notLaunched, untrusted: decision.untrusted } satisfies HandoffDecision;
});

/**
 * For a `choose` decision, prints the summary, asks the person and records their choice in the
 * manifest; any other decision passes through. The summary is flushed before the picker so it is
 * on screen while they choose.
 */
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

/**
 * Hands the terminal to the agent and makes its exit status the command's. When the agent can't
 * start, the manifest records that it wasn't launched; a permission error is the user's to fix,
 * any other spawn failure is a defect.
 */
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
          recordHandoff(project, notLaunched).pipe(Effect.ignore),
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

/**
 * Records a failed app launch in the manifest. A failed record is ignored unless its rollback
 * left paths unrestored, which `main` has to report.
 */
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

/** Opens the Codex app on the project; if it doesn't open, records that and prints the prompt. */
const launchApp = Effect.fn("handoff.launchApp")(function* (
  project: string,
  context: Parameters<typeof renderHandoff>[1],
) {
  const config = yield* AppConfig;
  const processes = yield* Processes;
  const opened = yield* processes
    .exec({
      argv: ["open", LAUNCH_ARGS["codex-app"].url(project, agentPrompt(context.invocation))],
      cwd: project,
      env: config.childEnv([]),
    })
    .pipe(
      Effect.map((finished) => finished.exitCode === 0),
      Effect.catchTag("SpawnFailed", () => Effect.succeed(false)),
    );
  if (opened) return;
  yield* recordAppFallback(project, notLaunched);
  yield* (yield* Output).result(null, renderHandoff(notLaunched, context));
});

/** Untrusted entries as the summary shows them: agent text shortens their paths. */
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

type SummaryContext = {
  shown: string;
  audience: Audience;
  untrusted: NewResult["untrusted"];
};

/** What `new` or `add` hands to `completeHandoff`. */
type CompleteHandoffInput = {
  project: string;
  agent: AgentId | undefined;
  untrusted: NewResult["untrusted"];
  decision: HandoffDecision;
  /** A dry run: the result text is the summary alone. */
  preview?: boolean;
  render: (context: SummaryContext) => string;
  encode: (handoff: NewResult["handoff"]) => unknown;
  /** Runs once the handoff is settled, before anything launches (telemetry). */
  beforeHandoff?: (decision: HandoffDecision) => Effect.Effect<void>;
};

/** Render the result, then print the next task or give the terminal to the selected agent. */
export const completeHandoff = (input: CompleteHandoffInput) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const output = yield* Output;
    const shown = yield* shownPath(host.cwd, input.project);
    const untrusted = yield* summaryTrust(input.untrusted);
    const summary = input.render({ shown, audience: output.audience, untrusted });
    // A person who chose has already seen the summary, so it isn't printed twice.
    const prefix = input.decision.kind === "choose" ? "" : `${summary}\n\n`;
    const decision = yield* resolveChoice(input.decision, input.project, summary);
    if (input.beforeHandoff) yield* input.beforeHandoff(decision);
    yield* (yield* Invocation).annotate({
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
    // The launch line has to reach the terminal before the agent takes it over.
    yield* output.flushNow;
    if (decision.via === "app") yield* launchApp(input.project, context);
    else yield* launchTerminal(decision, input.project);
  });
