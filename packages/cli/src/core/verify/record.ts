import type { Manifest } from "@steamfield/stacks-format";
import { RunRecord, type RunStep } from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Option, Path, Schema } from "effect";
import { AppConfig } from "../../config";
import { METADATA_DIR, RUNS_PATH, STATE_DIR } from "../../project-layout";
import type { VerifyResult } from "../../schemas/verify";
import { Telemetry } from "../../telemetry";
import { VERSION } from "../../version";
import { findProjectState, reasonOf, saveProjectState, warnUnwritten } from "../project-state";
import { printable } from "../text";
import type { RunResult } from "./run";
import type { Tamper } from "./tamper";

/** Where a project's run records go, relative to its root (ignored by its `.gitignore`). */
export { RUNS_PATH } from "../../project-layout";

/** What a finished run settles in the state record, for the result's `firstGreen` and `stateRecord`. */
export type RecordFacts = Pick<VerifyResult, "firstGreen" | "stateRecord">;

type RecordContext = {
  root: string;
  manifest: Manifest;
  tamper: Tamper;
  acceptedChanges: boolean;
};

type Finished = RunResult | VerifyResult;

const runStep = (step: Finished["steps"][number]): RunStep => ({
  name: step.name,
  phase: step.phase,
  ...(step.layer ? { layer: step.layer } : {}),
  status: step.status,
  ...(step.failureKind ? { failureKind: step.failureKind } : {}),
  ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
  durationMs: step.durationMs,
});

/**
 * Appends one encoded `RunRecord` line to `.stacks/state/runs.jsonl` with a single write.
 * `.stacks/` must resolve inside the project before `state/` is created in it, `state/` must
 * resolve inside too, and `runs.jsonl`, when it exists, must be a regular file with one link, so
 * neither a link to a directory nor one to a file can send the write elsewhere. Any failure or
 * refusal is one logged warning; the run's outcome and exit don't change.
 */
const appendRunRecord = (root: string, record: RunRecord) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(root, RUNS_PATH);
    const dir = path.dirname(file);
    const line = `${JSON.stringify(Schema.encodeSync(RunRecord)(record))}\n`;
    const refuse = (why: string) =>
      Effect.logWarning(`Run record not written (${why}): ${printable(file)}`);
    yield* Effect.gen(function* () {
      const realRoot = yield* fs.realPath(root);
      const inside = path.join(realRoot, METADATA_DIR);
      if ((yield* fs.realPath(path.dirname(dir))) !== inside)
        return yield* refuse("outside the project");
      yield* fs.makeDirectory(dir, { recursive: true });
      const realDir = yield* fs.realPath(dir);
      if (realDir !== path.join(realRoot, STATE_DIR)) return yield* refuse("outside the project");
      const target = path.join(realDir, path.basename(RUNS_PATH));
      const info = yield* fs.lstat(target).pipe(
        Effect.map(Option.some),
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed(Option.none()),
        ),
      );
      if (
        Option.isSome(info) &&
        (info.value.type !== "File" || Option.getOrElse(info.value.nlink, () => 1n) > 1n)
      )
        return yield* refuse("not a regular file");
      yield* fs.writeFileString(target, line, { flag: "a" });
    }).pipe(
      Effect.catchTag("PlatformError", (error) =>
        Effect.logWarning(`Run record not written (${reasonOf(error)}): ${printable(file)}`),
      ),
    );
  });

/**
 * After a run (verify's `onFinished`, so interrupted runs are recorded too, and after a changed
 * run): appends the run record, then sets the state record's `firstGreenAt` (first green run) and
 * `firstTestPassAt` (first run, of any scope, in which a `test`-layer step passed; never a
 * `changed` run), each written once and never overwritten. Only a record found by id is updated,
 * and it is read again first: one whose `verifyDigest` changed during the run (a concurrent
 * `--accept-changes`) is left alone with `stateRecord` false, and a timing field another run set
 * meanwhile is kept. A write that fails logs one warning and leaves `stateRecord` false; nothing
 * here fails.
 */
export const recordRun = (
  context: RecordContext,
  result: Finished,
): Effect.Effect<RecordFacts, never, FileSystem.FileSystem | Path.Path | AppConfig> =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const now = yield* Clock.currentTimeMillis;
    const record: RunRecord = {
      schemaVersion: 1,
      at: new Date(now - result.durationMs).toISOString(),
      cli: VERSION,
      agent: yield* config.agent,
      outcome: result.outcome,
      ...(result.stages ? { stages: result.stages } : {}),
      scope: result.scope,
      tamperCheck: context.tamper.tamperCheck,
      acceptedChanges: context.acceptedChanges,
      durationMs: result.durationMs,
      secondsSinceCreated: result.secondsSinceCreated,
      steps: result.steps.map(runStep),
    };
    yield* appendRunRecord(context.root, record);

    const facts = yield* settleTimings(context, result, now);
    const telemetry = yield* Effect.serviceOption(Telemetry);
    if (Option.isSome(telemetry)) yield* telemetry.value.recordVerify(record);
    return facts;
  });

const settleTimings = (context: RecordContext, result: Finished, now: number) =>
  Effect.gen(function* () {
    const checked = context.tamper.record;
    if (!checked) return { firstGreen: false, stateRecord: false };
    if (result.outcome === "changed") return { firstGreen: false, stateRecord: true };
    // Read again: a concurrent run or `--accept-changes` may have written the record since the
    // tamper check. A record that no longer holds the digest this run was checked against isn't
    // this run's to update.
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
