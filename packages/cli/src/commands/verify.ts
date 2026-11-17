/**
 * Handles verify planning, execution and reporting. `checkTamper` and `requireConfirmation` enforce
 * trust points 5 and 4 respectively.
 */
import { Clock, Effect, type FileSystem, type Path, Ref, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { AppConfig } from "../config";
import { locateManifest, readManifest } from "../core/manifest";
import { planVerify } from "../core/verify/plan";
import { type RecordFacts, recordRun } from "../core/verify/record";
import { renderVerify } from "../core/verify/report";
import { changedResult } from "../core/verify/result";
import { runVerify } from "../core/verify/run";
import { acceptChanges, checkTamper, createdAtOf, type Tamper } from "../core/verify/tamper";
import { PermissionDenied, VerifyChanged, VerifyFailed } from "../errors";
import { MANIFEST_PATH, RUNS_PATH } from "../project-layout";
import { VerifyResult } from "../schemas/verify";
import { Host } from "../services/host";
import { Output } from "../services/output";
import { Telemetry } from "../telemetry";
import { splitValues } from "./handoff";

type VerifyFlags = {
  readonly only: ReadonlyArray<string>;
  readonly skipTag: ReadonlyArray<string>;
  readonly all: boolean;
  readonly acceptChanges: boolean;
};

type Plan = Effect.Success<ReturnType<typeof planVerify>>;
type RecordContext = Parameters<typeof recordRun>[0];

/** Fails unless a person at a terminal is running the command (trust model point 4). */
const requireConfirmation = Effect.gen(function* () {
  const config = yield* AppConfig;
  const host = yield* Host;
  if ((yield* config.agent) !== "none")
    return yield* new PermissionDenied({ details: { reason: "agent" } });
  if (!host.stdinIsTTY) return yield* new PermissionDenied({ details: { reason: "no-tty" } });
});

/**
 * When accepting changes, `requireConfirmation` precedes planning. Planning rejects an invalid
 * `--only` before `checkTamper` or any baseline write.
 */
const prepareRun = (flags: VerifyFlags) =>
  Effect.gen(function* () {
    const located = yield* locateManifest((yield* Host).cwd);
    const read = yield* readManifest(located.path);
    if (flags.acceptChanges) yield* requireConfirmation;
    const options = {
      only: splitValues(flags.only),
      skipTags: splitValues(flags.skipTag),
      all: flags.all,
    };
    const plan = yield* planVerify(read.verify, options);
    const checked = yield* checkTamper(read, located.path);
    // The report names what was accepted (`result.changed`), in every audience.
    const { manifest, tamper } = flags.acceptChanges
      ? yield* acceptChanges(read, located.path, checked)
      : { manifest: read, tamper: checked };
    return { located, options, plan, manifest, tamper };
  });

/** Writes the report in the invocation's audience. */
const writeResult = (result: VerifyResult) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const output = yield* Output;
    yield* output.result(
      Schema.encodeSync(VerifyResult)(result),
      renderVerify(result, {
        invocation: host.invocation,
        audience: output.audience,
        style: output.style,
      }),
    );
  });

/** The changed-steps run: records it and reports which steps changed, running none of them. */
const reportChanged = (input: {
  context: RecordContext;
  plan: Plan;
  tamper: Tamper & { changed: NonNullable<Tamper["changed"]> };
  started: number;
}) =>
  Effect.gen(function* () {
    const { context, plan, tamper, started } = input;
    const result = yield* changedResult(plan, context.manifest, tamper, started);
    yield* recordRun(context, result);
    yield* (yield* Telemetry).flush;
    yield* writeResult(result);
    return yield* new VerifyChanged({ details: tamper.changed });
  });

/**
 * Runs the steps and returns the run with the facts its record settled (first green, state record
 * written). The record is written in the runner's finalizer so interrupted runs are recorded too;
 * the finalizer runs outside this context, so its services are captured here first.
 */
const runAndRecord = (
  context: RecordContext,
  project: Parameters<typeof runVerify>[0],
  options: Parameters<typeof runVerify>[1],
) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<
      FileSystem.FileSystem | Path.Path | AppConfig | Telemetry
    >();
    const facts = yield* Ref.make<RecordFacts>({ firstGreen: false, stateRecord: false });
    const run = yield* runVerify(project, options, (finished) =>
      recordRun(context, finished).pipe(
        Effect.flatMap((settled) => Ref.set(facts, settled)),
        Effect.provideContext(services),
      ),
    );
    return { run, facts: yield* Ref.get(facts) };
  });

/** The failed steps, each with its failure kind and exit code, for `VerifyFailed`'s details. */
function failedDetails(result: VerifyResult) {
  return {
    failed: result.steps.flatMap((step) =>
      step.status === "failed" && step.failureKind
        ? [
            {
              name: step.name,
              failureKind: step.failureKind,
              ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
            },
          ]
        : [],
    ),
    ...(result.stages === undefined ? {} : { stages: result.stages }),
  };
}

export const verifyCommand = Command.make(
  "verify",
  {
    only: Flag.String("only").pipe(
      Flag.withDescription(
        "Run only these check and serve steps, by name (repeatable or comma-separated), even when the preset skips them by default; setup and teardown still run. The outcome is partial, never green.",
      ),
      Flag.atLeast(0),
    ),
    skipTag: Flag.String("skip-tag").pipe(
      Flag.withDescription(
        "Skip steps carrying this tag (repeatable or comma-separated). The outcome is partial, never green.",
      ),
      Flag.atLeast(0),
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDescription(
        "Also run steps skipped by default: the hygiene checks (fill markers, harness doc, CI workflow, git hooks) and prod steps in a --sandbox project. Plain verify runs the code checks.",
      ),
      Flag.withDefault(false),
    ),
    acceptChanges: Flag.Boolean("accept-changes").pipe(
      Flag.withDescription(
        "For a person who changed the verify steps on purpose: record them as they are now, then run them. Refused (exit 6) under a detected agent or without a terminal on stdin.",
      ),
      Flag.withDefault(false),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis;
      const { located, options, plan, manifest, tamper } = yield* prepareRun(flags);
      const context = {
        root: located.root,
        manifest,
        tamper,
        acceptedChanges: flags.acceptChanges,
      };
      const { changed } = tamper;
      if (changed && !flags.acceptChanges)
        return yield* reportChanged({ context, plan, tamper: { ...tamper, changed }, started });

      const project = { root: located.root, manifest, createdAt: createdAtOf(manifest, tamper) };
      const { run, facts } = yield* runAndRecord(context, project, options);
      const result: VerifyResult = {
        ...run,
        tamperCheck: tamper.tamperCheck,
        ...(changed ? { changed } : {}),
        ...facts,
      };
      yield* (yield* Telemetry).flush;
      yield* writeResult(result);
      if (result.outcome === "failed")
        return yield* new VerifyFailed({ details: failedDetails(result) });
    }),
).pipe(
  Command.withDescription(
    `Run this project's verify steps from ${MANIFEST_PATH} (found from here or any directory above): setup, check, serve (each server probed, then stopped), then teardown, which always runs. Steps tagged hygiene (fill markers, harness doc, CI workflow, git hooks) run only with --all, and skipping them still counts as green. Prints each command before running it. First checks the steps against the copy recorded when the project was made; changed steps run nothing until a person runs --accept-changes. Every run appends a record to ${RUNS_PATH}. Exits 0 when green or partial, 2 outside a project or on an --only name that isn't a check or serve step, 3 on a bad manifest or a state record from a newer stacks, 5 when a step fails (VerifyFailed) or the steps changed (VerifyChanged), with the report still on stdout, 6 when the manifest can't be read or --accept-changes is refused, 130 when interrupted (teardown still runs).`,
  ),
  Command.withShortDescription("Run the project's verify steps: the definition of done."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Run the code checks from the project root" },
    {
      command: `${commandPath.join(" ")} --all`,
      description: "Also run the hygiene checks: the full definition of done",
    },
    {
      command: `${commandPath.join(" ")} --only lint,test`,
      description: "Rerun two checks while fixing them (outcome partial)",
    },
    {
      command: `${commandPath.join(" ")} --json`,
      description: "Get one VerifyResult object, as an agent would",
    },
  ]),
);
