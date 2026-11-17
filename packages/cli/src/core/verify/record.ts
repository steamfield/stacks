/**
 * Records verify history and first-pass times. Recording is best effort so filesystem failures
 * never change the run's outcome.
 */
import type { Manifest } from "@steamfield/stacks-format";
import { RunRecord, type RunStep } from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Option, Path, Schema } from "effect";
import { AppConfig } from "../../config";
import { METADATA_DIR, RUNS_PATH, STATE_DIR } from "../../project-layout";
import type { VerifyResult } from "../../schemas/verify";
import { Telemetry } from "../../telemetry";
import { VERSION } from "../../version";
import { findProjectState, reasonOf, saveProjectState, warnUnwritten } from "../project/state";
import { printable } from "../text/text";
import type { RunResult } from "./result";
import type { Tamper } from "./tamper";

/** Where a project's run records go, relative to its root (ignored by its `.gitignore`). */
export { RUNS_PATH } from "../../project-layout";

export type RecordFacts = Pick<VerifyResult, "firstGreen" | "stateRecord">;

export type RecordContext = {
  root: string;
  manifest: Manifest;
  tamper: Tamper;
  acceptedChanges: boolean;
};

type Finished = RunResult | VerifyResult;

/** A step as the run record keeps it: no command text, reason or output. */
const runStep = (step: Finished["steps"][number]): RunStep => ({
  name: step.name,
  phase: step.phase,
  ...(step.layer ? { layer: step.layer } : {}),
  status: step.status,
  ...(step.failureKind ? { failureKind: step.failureKind } : {}),
  ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
  durationMs: step.durationMs,
});

type RecordFields = { agent: RunRecord["agent"]; now: number };

/** Store when the run started even though the record is written after the run. */
const runRecord = (context: RecordContext, result: Finished, fields: RecordFields): RunRecord => ({
  schemaVersion: 1,
  at: new Date(fields.now - result.durationMs).toISOString(),
  cli: VERSION,
  agent: fields.agent,
  outcome: result.outcome,
  ...(result.stages ? { stages: result.stages } : {}),
  scope: result.scope,
  tamperCheck: context.tamper.tamperCheck,
  acceptedChanges: context.acceptedChanges,
  durationMs: result.durationMs,
  secondsSinceCreated: result.secondsSinceCreated,
  steps: result.steps.map(runStep),
});

/** An existing `runs.jsonl` is appended to only when it is a regular file with a single link. */
const isPlainFile = (info: FileSystem.File.Info) =>
  info.type === "File" && Option.getOrElse(info.nlink, () => 1n) <= 1n;

/**
 * Resolve both metadata directories inside the project so a link cannot redirect the append. Check
 * `.stacks/` before creating `state/`.
 */
const runsFile = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.dirname(path.join(root, RUNS_PATH));
    const realRoot = yield* fs.realPath(root);
    if ((yield* fs.realPath(path.dirname(dir))) !== path.join(realRoot, METADATA_DIR))
      return { refused: "outside the project" };
    yield* fs.makeDirectory(dir, { recursive: true });
    const realDir = yield* fs.realPath(dir);
    if (realDir !== path.join(realRoot, STATE_DIR)) return { refused: "outside the project" };
    const target = path.join(realDir, path.basename(RUNS_PATH));
    const info = yield* fs.lstat(target).pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(Option.none()),
      ),
    );
    if (Option.isSome(info) && !isPlainFile(info.value)) return { refused: "not a regular file" };
    return { target };
  });

/** Append each run as one encoded line in a single write. Failures or refusals log one warning. */
const appendRunRecord = (root: string, record: RunRecord) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(root, RUNS_PATH);
    const line = `${JSON.stringify(Schema.encodeSync(RunRecord)(record))}\n`;
    const warn = (why: string) =>
      Effect.logWarning(`Run record not written (${why}): ${printable(file)}`);
    yield* Effect.gen(function* () {
      const found = yield* runsFile(root);
      if (found.refused !== undefined) return yield* warn(found.refused);
      yield* fs.writeFileString(found.target, line, { flag: "a" });
    }).pipe(Effect.catchTag("PlatformError", (error) => warn(reasonOf(error))));
  });

/**
 * Append history even for changed and interrupted runs. Use `settleTimings` to record milestones.
 */
export const recordRun = (
  context: RecordContext,
  result: Finished,
): Effect.Effect<RecordFacts, never, FileSystem.FileSystem | Path.Path | AppConfig> =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const now = yield* Clock.currentTimeMillis;
    const record = runRecord(context, result, { agent: yield* config.agent, now });
    yield* appendRunRecord(context.root, record);

    const facts = yield* settleTimings(context, result, now);
    // Optional: a caller outside the command tree may not provide Telemetry.
    const telemetry = yield* Effect.serviceOption(Telemetry);
    if (Option.isSome(telemetry)) yield* telemetry.value.recordVerify(record);
    return facts;
  });

/**
 * Set milestone times once on the id-matched record. One passing `test`-layer step earns
 * `firstTestPassAt` in any scope, even in an overall failed run. A changed run cannot earn it.
 * Report a write failure as `stateRecord: false` and log one warning.
 */
const settleTimings = (context: RecordContext, result: Finished, now: number) =>
  Effect.gen(function* () {
    const checked = context.tamper.record;
    if (!checked) return { firstGreen: false, stateRecord: false };
    if (result.outcome === "changed") return { firstGreen: false, stateRecord: true };
    // Reread after the run to keep timings another run already set. If `--accept-changes`
    // replaced the digest since the tamper check, this run's timings do not apply.
    const found = yield* findProjectState(context.manifest.projectId).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (found?.state.verifyDigest !== checked.state.verifyDigest)
      return { firstGreen: false, stateRecord: false };
    const at = new Date(now).toISOString();
    const green = result.outcome === "green" && found.state.firstGreenAt === null;
    const testPassed =
      found.state.firstTestPassAt === null &&
      result.steps.some((step) => step.layer === "test" && step.status === "passed");
    if (!green && !testPassed) return { firstGreen: false, stateRecord: true };
    const updated = {
      ...found.state,
      ...(green ? { firstGreenAt: at } : {}),
      ...(testPassed ? { firstTestPassAt: at } : {}),
    };
    return yield* saveProjectState(updated, found.path).pipe(
      Effect.as({ firstGreen: green, stateRecord: true }),
      Effect.catchTag("PlatformError", (error) =>
        warnUnwritten(error, found.path).pipe(Effect.as({ firstGreen: false, stateRecord: false })),
      ),
    );
  });
