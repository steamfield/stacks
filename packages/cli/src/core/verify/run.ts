/**
 * Runs planned verify steps serially after `checkTamper` and builds the result. Scoped teardown
 * and recording let an interrupted run settle before the command ends.
 */
import type { Manifest, Outcome } from "@steamfield/stacks-format";
import { Cause, Clock, Effect, Exit, FileSystem } from "effect";
import { AGENT_MARKER_NAMES, AppConfig, CLI_SETTING_NAMES } from "../../config";
import type { StepResult, VerifyResult } from "../../schemas/verify";
import { stepFinished, stepStarted } from "./events";
import {
  isAppStep,
  type PlannedStep,
  planVerify,
  type SelectOptions,
  secondsSinceCreated,
  skippedStep,
  type VerifyPlan,
} from "./plan";
import { runStep, type StepContext } from "./step";

/** Use `createdAtOf` because the manifest timestamp is editable and outside the digest. */
type VerifyProject = { root: string; manifest: Manifest; createdAt: string };
type VerifyOptions = SelectOptions;
/** Omit tamper fields and the `changed` outcome because a blocked run never enters the runner. */
export type RunResult = Omit<
  VerifyResult,
  "outcome" | "tamperCheck" | "changed" | "firstGreen" | "stateRecord"
> & { outcome: Exclude<VerifyResult["outcome"], "changed"> };

type Stage = "base" | "app";
type Stages = NonNullable<RunResult["stages"]>;

const SETUP_FAILED = "an earlier setup step failed";
const BASE_FAILED = "base-failed";
const BASE_PARTIAL = "the base did not fully run; the app stage waits for a full verify";
const INTERRUPTED = "the run was interrupted";

/**
 * Both the stage runner and its finalizers write this state so interruption still yields a whole
 * result.
 */
type RunState = {
  readonly plan: VerifyPlan;
  readonly options: VerifyOptions;
  readonly context: StepContext;
  readonly results: Map<string, StepResult>;
  stages: Stages;
  /** The stage that started last; an interrupt that reaches the run is charged to it. */
  activeStage: Stage;
};

type StageRun = {
  readonly stage: Stage;
  readonly steps: ReadonlyArray<PlannedStep>;
  setupFailed: boolean;
  current: { step: PlannedStep; started: number } | undefined;
};

/**
 * Call after `checkTamper`. The run finalizer calls `onFinished` for completed results and
 * interruptions. Defects trigger teardown without recording a run.
 */
export const runVerify = (
  project: VerifyProject,
  options: VerifyOptions,
  onFinished: (result: RunResult) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const plan = yield* planVerify(project.manifest.verify, options);
    const context = yield* stepContext(project);
    const started = yield* Clock.currentTimeMillis;
    const state: RunState = {
      plan,
      options,
      context,
      results: new Map(),
      stages: { base: "green", app: null },
      activeStage: "base",
    };
    const app = plan.steps.filter(isAppStep);
    const summary = (interrupted: boolean) =>
      summarize(state, { app, started, createdAt: project.createdAt, interrupted });

    return yield* Effect.gen(function* () {
      yield* runStage(
        state,
        "base",
        plan.steps.filter((step) => !isAppStep(step)),
      );
      yield* runApp(state, app);
      return yield* summary(false);
    }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return onFinished(exit.value);
        if (Cause.hasInterruptsOnly(exit.cause))
          return summary(true).pipe(Effect.flatMap(onFinished));
        return Effect.void;
      }),
    );
  });

const stepContext = (project: VerifyProject) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* AppConfig;
    const realRoot = yield* fs
      .realPath(project.root)
      .pipe(Effect.orElseSucceed(() => project.root));
    // The captured environment wins over the manifest's defaults (`PORT_WEB=5187 verify`), and no
    // agent marker or CLI setting reaches a step unless the manifest supplies it.
    const env = {
      ...project.manifest.env,
      ...config.childEnv([...AGENT_MARKER_NAMES, ...CLI_SETTING_NAMES]),
    };
    return { root: project.root, realRoot, env };
  });

/** Each stage finalizes before the next so its teardown can clean up even after interruption. */
const runStage = (state: RunState, stage: Stage, steps: ReadonlyArray<PlannedStep>) => {
  state.activeStage = stage;
  const run: StageRun = { stage, steps, setupFailed: false, current: undefined };
  return Effect.forEach(
    steps.filter((step) => step.phase !== "teardown"),
    (step) => runStageStep(state, run, step),
    { discard: true },
  ).pipe(Effect.onExit((exit) => finishStage(state, run, exit)));
};

/**
 * After a setup failure, skip the remaining setup, check and serve steps. A check failure still
 * allows the other checks.
 */
const stageSkipReason = (state: RunState, run: StageRun, step: PlannedStep) =>
  state.plan.skipped.get(step.name) ??
  (run.setupFailed && step.phase !== "teardown" ? SETUP_FAILED : undefined);

const runStageStep = (state: RunState, run: StageRun, step: PlannedStep) =>
  Effect.gen(function* () {
    const skip = stageSkipReason(state, run, step);
    if (skip !== undefined) {
      state.results.set(step.name, skippedStep(step, skip));
      return;
    }
    run.current = { step, started: yield* Clock.currentTimeMillis };
    yield* stepStarted(step);
    const result = yield* runStep(step, state.context);
    run.current = undefined;
    state.results.set(step.name, result);
    yield* stepFinished(result);
    if (step.phase === "setup" && result.status === "failed") run.setupFailed = true;
  });

/**
 * On interruption, settle unfinished work before teardown. Defects leave the stage outcome unset
 * because the run is not recorded.
 */
const finishStage = (state: RunState, run: StageRun, exit: Exit.Exit<unknown, unknown>) =>
  Effect.gen(function* () {
    const interrupted = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
    if (interrupted) yield* recordStageInterrupt(state, run);
    yield* Effect.forEach(
      run.steps.filter((step) => step.phase === "teardown"),
      (step) => runStageStep(state, run, step),
      { discard: true },
    );
    if (Exit.isSuccess(exit) || interrupted)
      state.stages = { ...state.stages, [run.stage]: stageOutcome(state, run.steps, interrupted) };
  });

/**
 * Time the interrupted step through the interruption and skip unreached work. Leave teardown
 * to `finishStage`.
 */
const recordStageInterrupt = (state: RunState, run: StageRun) =>
  Effect.gen(function* () {
    if (run.current) {
      const { step, started } = run.current;
      state.results.set(step.name, {
        ...skippedStep(step, INTERRUPTED),
        status: "failed",
        failureKind: "interrupted",
        durationMs: (yield* Clock.currentTimeMillis) - started,
      });
    }
    for (const step of run.steps)
      if (step.phase !== "teardown" && !state.results.has(step.name))
        state.results.set(step.name, skippedStep(step, INTERRUPTED));
  });

/** Only explicit selection skips make a stage partial. Default skips still allow green. */
function stageOutcome(
  state: RunState,
  steps: ReadonlyArray<PlannedStep>,
  interrupted: boolean,
): Outcome {
  if (interrupted) return "interrupted";
  if (steps.some((step) => state.results.get(step.name)?.status === "failed")) return "failed";
  const skippedBySelection = (step: PlannedStep) =>
    state.plan.skipped.has(step.name) && !(step.skipByDefault && !state.options.all);
  if (steps.some(skippedBySelection)) return "partial";
  return "green";
}

/**
 * An app check is meaningful only on a green base. Skip all app steps if the base failed, was
 * partial or selection left no app steps to run.
 */
const runApp = (state: RunState, app: ReadonlyArray<PlannedStep>) =>
  Effect.gen(function* () {
    if (state.stages.base !== "green") {
      const reason = state.stages.base === "partial" ? BASE_PARTIAL : BASE_FAILED;
      skipSteps(state, app, () => reason);
    } else if (app.some((step) => !state.plan.skipped.has(step.name))) {
      yield* runStage(state, "app", app);
    } else {
      skipSteps(state, app, (step) => state.plan.skipped.get(step.name) ?? INTERRUPTED);
    }
  });

const skipSteps = (
  state: RunState,
  steps: ReadonlyArray<PlannedStep>,
  reason: (step: PlannedStep) => string,
) => {
  for (const step of steps) state.results.set(step.name, skippedStep(step, reason(step)));
};

/** Charge interruption to the most recent stage, even if its masked teardown already finished. */
const markRunInterrupted = (state: RunState, app: ReadonlyArray<PlannedStep>) => {
  state.stages = { ...state.stages, [state.activeStage]: "interrupted" };
  if (state.activeStage === "base") skipSteps(state, app, () => BASE_FAILED);
};

type SummaryOptions = {
  app: ReadonlyArray<PlannedStep>;
  started: number;
  createdAt: string;
  interrupted: boolean;
};

/** Keep results in plan order with a skipped row for any step interruption left unreached. */
const summarize = (state: RunState, options: SummaryOptions) =>
  Effect.gen(function* () {
    if (options.interrupted) markRunInterrupted(state, options.app);
    const { plan } = state;
    const steps = plan.steps.map(
      (step) => state.results.get(step.name) ?? skippedStep(step, INTERRUPTED),
    );
    const ended = yield* Clock.currentTimeMillis;
    const count = (status: StepResult["status"]) =>
      steps.filter((step) => step.status === status).length;
    const result: RunResult = {
      outcome: runOutcome(options.interrupted, count("failed"), plan.scope),
      scope: plan.scope,
      ...(options.app.length ? { stages: { ...state.stages } } : {}),
      steps,
      totals: { passed: count("passed"), failed: count("failed"), skipped: count("skipped") },
      durationMs: ended - options.started,
      secondsSinceCreated: secondsSinceCreated(options.createdAt, ended),
    };
    return result;
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
