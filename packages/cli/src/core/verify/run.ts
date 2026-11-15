/**
 * Runs a project's verify steps for `stacks verify` and builds the result the command reports.
 *
 * `commands/verify.ts` calls `runVerify` once the tamper check (`tamper.ts::checkTamper`) has
 * passed or a person accepted the change. `plan.ts::planVerify` orders the steps; each one runs
 * through `step.ts::runStep`, which never fails, so a step's failure is a value in the result.
 *
 * A run has up to two stages. The base stage holds every step not tagged `app`; the app stage
 * (steps for an application fragment) runs only after a green base, because an app check means
 * nothing on a broken base. Inside a stage the phases run in order: setup stops at its first
 * failure (later setup, check and serve steps are skipped), every check runs, and teardown always
 * runs in the stage's finalizer, so servers and containers are cleaned up even after Ctrl+C. Steps
 * run one at a time; nothing here runs concurrently.
 *
 * Interruption is part of the result. An interrupt marks the running step failed as `interrupted`
 * and the steps it never reached skipped, and the run's finalizer still builds a result and hands
 * it to `onFinished`, which records it (`record.ts::recordRun`). A run that ends in a defect tears
 * down but isn't recorded. Start at `runVerify`.
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

/**
 * `createdAt` is what `secondsSinceCreated` counts from: the state record's when there is one
 * (`tamper.ts::createdAtOf`), since the manifest's is outside the digest and editable.
 */
type VerifyProject = { root: string; manifest: Manifest; createdAt: string };
type VerifyOptions = SelectOptions;
/**
 * What the runner knows about a run: the result without the tamper check's fields, which
 * `commands/verify.ts` adds, and never `changed`, since a changed run doesn't reach the runner.
 */
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
 * What a run has settled so far. The stage runner and the run's finalizer both write here, because
 * an interrupt can land in either and the finalizer must still build a whole result.
 */
type RunState = {
  readonly plan: VerifyPlan;
  readonly options: VerifyOptions;
  readonly context: StepContext;
  /** Each step's result once known, by step name. */
  readonly results: Map<string, StepResult>;
  stages: Stages;
  /** The stage that started last; an interrupt that reaches the run is charged to it. */
  activeStage: Stage;
};

/** One stage while it runs: its steps, whether a setup step failed, and the step running now. */
type StageRun = {
  readonly stage: Stage;
  readonly steps: ReadonlyArray<PlannedStep>;
  setupFailed: boolean;
  current: { step: PlannedStep; started: number } | undefined;
};

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

/** Where steps run (the root and its real path) and the environment each step gets. */
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

/**
 * Runs one stage: setup, check and serve steps in order, then teardown in the stage's finalizer.
 */
const runStage = (state: RunState, stage: Stage, steps: ReadonlyArray<PlannedStep>) => {
  state.activeStage = stage;
  const run: StageRun = { stage, steps, setupFailed: false, current: undefined };
  return Effect.forEach(
    steps.filter((step) => step.phase !== "teardown"),
    (step) => runStageStep(state, run, step),
    { discard: true },
  ).pipe(Effect.onExit((exit) => finishStage(state, run, exit)));
};

/** Why a step of this stage won't run: its selection, or a setup step that failed before it. */
const stageSkipReason = (state: RunState, run: StageRun, step: PlannedStep) =>
  state.plan.skipped.get(step.name) ??
  (run.setupFailed && step.phase !== "teardown" ? SETUP_FAILED : undefined);

/** Runs or skips one step, recording its result and the live events around it. */
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
 * The stage's finalizer, run however the stage ended. On an interrupt, the steps that didn't
 * finish are charged to it first. Teardown runs in every case. A stage that ended in a defect
 * keeps its outcome unset, since the run won't be recorded.
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
 * The running step fails as `interrupted`, timed up to now, and every setup, check or serve step
 * the stage never reached is skipped. Teardown steps are left for the finalizer to run.
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

/**
 * A stage's outcome once its teardown ran. A step left out by `--only` or `--skip-tag` makes it
 * partial; one skipped only by default (hygiene, or `prod` under `--sandbox`) doesn't.
 */
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
 * The app stage runs only after a green base, and only when selection left at least one of its
 * steps in. Otherwise every app step is skipped with the reason that applies.
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

/**
 * Charges an interrupt that reached the run to the stage that started last. An interrupt during
 * a stage's masked teardown arrives here after that stage's finalizer has already settled it.
 */
const markRunInterrupted = (state: RunState, app: ReadonlyArray<PlannedStep>) => {
  state.stages = { ...state.stages, [state.activeStage]: "interrupted" };
  if (state.activeStage === "base") skipSteps(state, app, () => BASE_FAILED);
};

type SummaryOptions = {
  app: ReadonlyArray<PlannedStep>;
  /** When the run began, from Clock. */
  started: number;
  createdAt: string;
  interrupted: boolean;
};

/** The run's result: every planned step in run order (unreached ones skipped), totals and times. */
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
