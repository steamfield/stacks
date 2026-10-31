import type { Manifest, Outcome } from "@steamfield/stacks-format";
import { Cause, Clock, Effect, Exit, FileSystem } from "effect";
import { AGENT_MARKER_NAMES, AppConfig } from "../../config";
import type { StepResult, VerifyResult } from "../../schemas/verify";
import { stepFinished, stepStarted } from "./events";
import { type PlannedStep, planVerify, type SelectOptions } from "./plan";
import { runStep } from "./step";

/**
 * `createdAt` is what `secondsSinceCreated` counts from: the state record's when there is one
 * (`tamper.ts::createdAtOf`), since the manifest's is outside the digest and editable.
 */
export type VerifyProject = { root: string; manifest: Manifest; createdAt: string };
export type VerifyOptions = SelectOptions;
/**
 * What the runner knows about a run: the result without the tamper check's fields, which the
 * command adds (1.3b), and never `changed`, since a changed run doesn't reach the runner.
 */
export type RunResult = Omit<
  VerifyResult,
  "outcome" | "tamperCheck" | "changed" | "firstGreen" | "stateRecord"
> & { outcome: Exclude<VerifyResult["outcome"], "changed"> };

const SETUP_FAILED = "an earlier setup step failed";
const BASE_FAILED = "base-failed";
const BASE_PARTIAL = "the base did not fully run; the app stage waits for a full verify";
const INTERRUPTED = "the run was interrupted";

/**
 * Runs a project's verify steps and returns the result. The manifest is taken as already checked
 * (`tamper.ts::checkTamper` runs before this). Setup stops at its first failure, which skips the check
 * and serve steps; every check runs. Each stage tears down in its own finalizer before the next
 * stage starts. A base failure skips every app step. `onFinished` runs in the run's finalizer,
 * so an interrupted run still tears down and records its outcome before the command ends.
 * Other exceptional exits tear down without recording.
 */
export const runVerify = (
  project: VerifyProject,
  options: VerifyOptions,
  onFinished: (result: RunResult) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* AppConfig;
    const plan = yield* planVerify(project.manifest.verify, options);
    const realRoot = yield* fs
      .realPath(project.root)
      .pipe(Effect.orElseSucceed(() => project.root));
    // The captured environment wins over the manifest's defaults (`PORT_WEB=5187 verify`), and no
    // agent marker reaches a step: it must behave the same whoever ran verify.
    const env = { ...project.manifest.env, ...config.childEnv(AGENT_MARKER_NAMES) };
    const context = { root: project.root, realRoot, env };
    const started = yield* Clock.currentTimeMillis;
    const results = new Map<string, StepResult>();
    const base = plan.steps.filter((step) => !step.tags.includes("app"));
    const app = plan.steps.filter((step) => step.tags.includes("app"));
    let stages: NonNullable<RunResult["stages"]> = { base: "green", app: null };
    let activeStage: "base" | "app" = "base";

    const stageOutcome = (steps: ReadonlyArray<PlannedStep>, interrupted: boolean): Outcome => {
      if (interrupted) return "interrupted";
      if (steps.some((step) => results.get(step.name)?.status === "failed")) return "failed";
      if (
        steps.some((step) => plan.skipped.has(step.name) && !(step.skipByDefault && !options.all))
      )
        return "partial";
      return "green";
    };

    const runStage = (stage: "base" | "app", steps: ReadonlyArray<PlannedStep>) => {
      activeStage = stage;
      let setupFailed = false;
      let current: { step: PlannedStep; started: number } | undefined;
      const skipReason = (step: PlannedStep) =>
        plan.skipped.get(step.name) ??
        (setupFailed && step.phase !== "teardown" ? SETUP_FAILED : undefined);
      const runOne = (step: PlannedStep) =>
        Effect.gen(function* () {
          const skip = skipReason(step);
          if (skip !== undefined) {
            results.set(step.name, skipped(step, skip));
            return;
          }
          current = { step, started: yield* Clock.currentTimeMillis };
          yield* stepStarted(step);
          const result = yield* runStep(step, context);
          current = undefined;
          results.set(step.name, result);
          yield* stepFinished(result);
          if (step.phase === "setup" && result.status === "failed") setupFailed = true;
        });
      const interruptStage = Effect.gen(function* () {
        if (current) {
          const { step, started: at } = current;
          results.set(step.name, {
            ...skipped(step, INTERRUPTED),
            status: "failed",
            failureKind: "interrupted",
            durationMs: (yield* Clock.currentTimeMillis) - at,
          });
        }
        for (const step of steps)
          if (step.phase !== "teardown" && !results.has(step.name))
            results.set(step.name, skipped(step, INTERRUPTED));
      });
      return Effect.forEach(
        steps.filter((step) => step.phase !== "teardown"),
        runOne,
        {
          discard: true,
        },
      ).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const interrupted = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
            if (interrupted) yield* interruptStage;
            yield* Effect.forEach(
              steps.filter((step) => step.phase === "teardown"),
              runOne,
              { discard: true },
            );
            if (Exit.isSuccess(exit) || interrupted) {
              const outcome = stageOutcome(steps, interrupted);
              stages = { ...stages, [stage]: outcome };
            }
          }),
        ),
      );
    };

    const skipApp = (reason: (step: PlannedStep) => string) => {
      for (const step of app) results.set(step.name, skipped(step, reason(step)));
    };
    const interruptRun = () => {
      // An interrupt during masked teardown reaches the outer run after the stage finalizer.
      stages = { ...stages, [activeStage]: "interrupted" };
      if (activeStage === "base") skipApp(() => BASE_FAILED);
    };

    const result = (interrupted: boolean) =>
      Effect.gen(function* () {
        if (interrupted) interruptRun();
        const steps = plan.steps.map(
          (step) => results.get(step.name) ?? skipped(step, INTERRUPTED),
        );
        const ended = yield* Clock.currentTimeMillis;
        const count = (status: StepResult["status"]) =>
          steps.filter((step) => step.status === status).length;
        const created = Date.parse(project.createdAt);
        const outcome = runOutcome(interrupted, count("failed"), plan.scope);
        return {
          outcome,
          scope: plan.scope,
          ...(app.length ? { stages: { ...stages } } : {}),
          steps,
          totals: { passed: count("passed"), failed: count("failed"), skipped: count("skipped") },
          durationMs: ended - started,
          secondsSinceCreated: Number.isFinite(created)
            ? Math.max(0, Math.floor((ended - created) / 1000))
            : 0,
        };
      });

    const runApp = Effect.gen(function* () {
      if (stages.base !== "green") {
        const reason = stages.base === "partial" ? BASE_PARTIAL : BASE_FAILED;
        skipApp(() => reason);
      } else if (app.some((step) => !plan.skipped.has(step.name))) {
        yield* runStage("app", app);
      } else {
        skipApp((step) => plan.skipped.get(step.name) ?? INTERRUPTED);
      }
    });

    return yield* Effect.gen(function* () {
      yield* runStage("base", base);
      yield* runApp;
      return yield* result(false);
    }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return onFinished(exit.value);
        if (Cause.hasInterruptsOnly(exit.cause))
          return result(true).pipe(Effect.flatMap(onFinished));
        return Effect.void;
      }),
    );
  });

const skipped = (step: PlannedStep, reason: string): StepResult => ({
  name: step.name,
  phase: step.phase,
  ...(step.layer ? { layer: step.layer } : {}),
  command: step.run,
  status: "skipped",
  durationMs: 0,
  reason,
});

function runOutcome(
  interrupted: boolean,
  failed: number,
  scope: RunResult["scope"],
): Exclude<Outcome, "changed"> {
  if (interrupted) return "interrupted";
  if (failed) return "failed";
  if (scope === "partial") return "partial";
  return "green";
}
