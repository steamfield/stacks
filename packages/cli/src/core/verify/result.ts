import type { Manifest, Outcome } from "@steamfield/stacks-format";
import { Clock, Effect } from "effect";
import type { StepResult, VerifyResult } from "../../schemas/verify";
import { isAppStep, type PlannedStep, stepFields, type VerifyPlan } from "./plan";
import type { StepContext } from "./step";
import { type ChangedTamper, createdAtOf } from "./tamper";

/** Omit tamper fields and the `changed` outcome because a blocked run never enters the runner. */
export type RunResult = Omit<
  VerifyResult,
  "outcome" | "tamperCheck" | "changed" | "firstGreen" | "stateRecord"
> & { outcome: Exclude<VerifyResult["outcome"], "changed"> };

export type Stage = "base" | "app";
type Stages = NonNullable<RunResult["stages"]>;

/**
 * Both the stage runner and its finalizers write this state so interruption still yields a whole
 * result.
 */
export type RunState = {
  readonly plan: VerifyPlan;
  readonly context: StepContext;
  readonly results: Map<string, StepResult>;
  stages: Stages;
  /** The stage that started last; an interrupt that reaches the run is charged to it. */
  activeStage: Stage;
};

export const BASE_FAILED = "base-failed";
export const INTERRUPTED = "the run was interrupted";
const CHANGED = "not run: the verify steps changed since they were recorded";

export const skippedStep = (step: PlannedStep, reason: string): StepResult => ({
  ...stepFields(step),
  status: "skipped",
  durationMs: 0,
  reason,
});

/** Whole seconds from `createdAt` to `now`, never negative; 0 when `createdAt` doesn't parse. */
export const secondsSinceCreated = (createdAt: string, now: number) => {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 1000)) : 0;
};

export const skipSteps = (
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
export const summarize = (state: RunState, options: SummaryOptions) =>
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

/** A changed run skips every step, including teardown, because no setup ran. */
export const changedResult = (
  plan: VerifyPlan,
  manifest: Manifest,
  tamper: ChangedTamper,
  started: number,
): Effect.Effect<VerifyResult> =>
  Effect.gen(function* () {
    const ended = yield* Clock.currentTimeMillis;
    const result: VerifyResult = {
      outcome: "changed",
      ...(plan.steps.some(isAppStep) ? { stages: { base: "changed", app: null } } : {}),
      scope: plan.scope,
      steps: plan.steps.map((step) => skippedStep(step, CHANGED)),
      totals: { passed: 0, failed: 0, skipped: plan.steps.length },
      durationMs: ended - started,
      secondsSinceCreated: secondsSinceCreated(createdAtOf(manifest, tamper), ended),
      tamperCheck: tamper.tamperCheck,
      changed: tamper.changed,
      firstGreen: false,
      stateRecord: tamper.record !== undefined,
    };
    return result;
  });
