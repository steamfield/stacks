import { Clock, Effect, type FileSystem, type Path, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { AppConfig } from "../config";
import { locateManifest, readManifest } from "../core/manifest";
import { planVerify } from "../core/verify/plan";
import { type RecordFacts, recordRun } from "../core/verify/record";
import { renderVerify } from "../core/verify/report";
import { runVerify } from "../core/verify/run";
import { acceptChanges, changedResult, checkTamper, createdAtOf } from "../core/verify/tamper";
import { PermissionDenied, VerifyChanged, VerifyFailed } from "../errors";
import { MANIFEST_PATH, RUNS_PATH } from "../project-layout";
import { VerifyResult } from "../schemas/verify";
import { Host } from "../services/host";
import { Output } from "../services/output";
import { Telemetry } from "../telemetry";

/** Repeated flags, each value also split on commas: `--only a --only b,c`. */
const names = (values: ReadonlyArray<string>) =>
  values.flatMap((value) => value.split(",")).filter((value) => value !== "");

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
        "Also run steps skipped by default (prod steps in a --sandbox project).",
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
      const host = yield* Host;
      const output = yield* Output;
      const telemetry = yield* Telemetry;
      const started = yield* Clock.currentTimeMillis;
      const located = yield* locateManifest(host.cwd);
      let manifest = yield* readManifest(located.path);
      if (flags.acceptChanges) yield* requireConfirmation;
      const options = { only: names(flags.only), skipTags: names(flags.skipTag), all: flags.all };
      const plan = yield* planVerify(manifest.verify, options);
      let tamper = yield* checkTamper(manifest, located.path);
      // The report names what was accepted (`result.changed`), in every audience.
      if (flags.acceptChanges)
        ({ manifest, tamper } = yield* acceptChanges(manifest, located.path, tamper));
      const context = {
        root: located.root,
        manifest,
        tamper,
        acceptedChanges: flags.acceptChanges,
      };
      const write = (result: VerifyResult) =>
        output.result(
          Schema.encodeSync(VerifyResult)(result),
          renderVerify(result, {
            invocation: host.invocation,
            audience: output.audience,
            style: output.style,
          }),
        );

      const { changed } = tamper;
      if (changed && !flags.acceptChanges) {
        const result = yield* changedResult(plan, manifest, { ...tamper, changed }, started);
        yield* recordRun(context, result);
        yield* telemetry.flush;
        yield* write(result);
        return yield* new VerifyChanged({ details: changed });
      }

      // The record is written in the runner's finalizer, so interrupted runs are recorded too; its
      // services are captured here, before the callback leaves this context.
      const services = yield* Effect.context<
        FileSystem.FileSystem | Path.Path | AppConfig | Telemetry
      >();
      let facts: RecordFacts = { firstGreen: false, stateRecord: false };
      const project = { root: located.root, manifest, createdAt: createdAtOf(manifest, tamper) };
      const run = yield* runVerify(project, options, (finished) =>
        recordRun(context, finished).pipe(
          Effect.tap((settled) =>
            Effect.sync(() => {
              facts = settled;
            }),
          ),
          Effect.asVoid,
          Effect.provideContext(services),
        ),
      );
      const result: VerifyResult = {
        ...run,
        tamperCheck: tamper.tamperCheck,
        ...(changed ? { changed } : {}),
        ...facts,
      };
      yield* telemetry.flush;
      yield* write(result);
      if (result.outcome === "failed")
        return yield* new VerifyFailed({
          details: {
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
          },
        });
    }),
).pipe(
  Command.withDescription(
    `Run this project's verify steps from ${MANIFEST_PATH} (found from here or any directory above): setup, check, serve (each server probed, then stopped), then teardown, which always runs. Prints each command before running it. First checks the steps against the copy recorded when the project was made; changed steps run nothing until a person runs --accept-changes. Every run appends a record to ${RUNS_PATH}. Exits 0 when green or partial, 2 outside a project or on an --only name that isn't a check or serve step, 3 on a bad manifest or a state record from a newer stacks, 5 when a step fails (VerifyFailed) or the steps changed (VerifyChanged), with the report still on stdout, 6 when the manifest can't be read or --accept-changes is refused, 130 when interrupted (teardown still runs).`,
  ),
  Command.withShortDescription("Run the project's verify steps: the definition of done."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Run every step from the project root" },
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

const requireConfirmation = Effect.gen(function* () {
  const config = yield* AppConfig;
  const host = yield* Host;
  if ((yield* config.agent) !== "none")
    return yield* new PermissionDenied({ details: { reason: "agent" } });
  if (!host.stdinIsTTY) return yield* new PermissionDenied({ details: { reason: "no-tty" } });
});
