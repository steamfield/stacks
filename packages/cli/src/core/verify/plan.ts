/** Orders manifest steps and applies verify's selection flags without running anything. */
import type { ManifestStep } from "@steamfield/stacks-format";
import { type Phase, type ResolvedStep, withStepDefaults } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { BadInput } from "../../errors";
import type { StepResult } from "../../schemas/verify";

const PHASES: ReadonlyArray<Phase> = ["setup", "check", "serve", "teardown"];
/** Steps that check the project's hygiene (fill markers, harness, CI, hooks), not its code. */
export const HYGIENE_TAG = "hygiene";
export const HYGIENE_SKIPPED = "a hygiene check; --all or --only <name> runs it";
const PRESET_SKIPPED = "skipped by default in this preset; --all or --only <name> runs it";
const NOT_SELECTED = "not selected by --only";

export type PlannedStep = ResolvedStep & { skipByDefault: boolean };

export type SelectOptions = {
  only: ReadonlyArray<string>;
  skipTags: ReadonlyArray<string>;
  all: boolean;
};

export type VerifyPlan = {
  /** In run order: base then app, each by phase and then manifest order. */
  steps: ReadonlyArray<PlannedStep>;
  /** Steps left out by selection, with the fixed reason each is skipped. */
  skipped: ReadonlyMap<string, string>;
  scope: "full" | "partial";
};

/** The fields every step result copies from its planned step, in the result's key order. */
export const stepFields = (step: PlannedStep) => ({
  name: step.name,
  phase: step.phase,
  ...(step.layer ? { layer: step.layer } : {}),
  command: step.run,
});

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

export const isAppStep = (step: PlannedStep) => step.tags.includes("app");

/**
 * Keep setup and teardown outside `--only` because selected checks still depend on them.
 * `--skip-tag` and default skips can affect any phase.
 */
const isSelectable = (step: PlannedStep) => step.phase === "check" || step.phase === "serve";

/**
 * Applies the manifest's defaults. A `hygiene`-tagged step is skipped by default like a step the
 * preset marked (`prod` under `--sandbox`). `owner` only says which entry contributed the step.
 */
const resolveStep = ({ owner: _owner, skipByDefault, ...step }: ManifestStep): PlannedStep => {
  const defaults = withStepDefaults(step);
  return { ...defaults, skipByDefault: skipByDefault || defaults.tags.includes(HYGIENE_TAG) };
};

/** Run base before app, by phase within each stage and in manifest order within each phase. */
const runOrder = (steps: ReadonlyArray<PlannedStep>) =>
  [false, true].flatMap((app) =>
    PHASES.flatMap((phase) =>
      steps.filter((step) => isAppStep(step) === app && step.phase === phase),
    ),
  );

/** Why the selection flags leave this step out, or undefined when it runs. First match wins. */
function selectionSkip(step: PlannedStep, options: SelectOptions): string | undefined {
  if (step.skipByDefault && !options.all && !options.only.includes(step.name))
    return step.tags.includes(HYGIENE_TAG) ? HYGIENE_SKIPPED : PRESET_SKIPPED;
  if (options.only.length > 0 && isSelectable(step) && !options.only.includes(step.name))
    return NOT_SELECTED;
  const tag = step.tags.find((item) => options.skipTags.includes(item));
  return tag === undefined ? undefined : `tagged ${tag}; --skip-tag leaves it out`;
}

/**
 * `--all` lifts default skips. A name in `--only` also lifts the default skip for that step.
 * `--only` and `--skip-tag` still filter steps and make the run partial even with `--all`.
 */
export function planVerify(
  manifestSteps: ReadonlyArray<ManifestStep>,
  options: SelectOptions,
): Effect.Effect<VerifyPlan, BadInput> {
  const steps = runOrder(manifestSteps.map(resolveStep));
  const known = steps
    .filter(isSelectable)
    .map((step) => step.name)
    .sort();
  const unknown = options.only.find((name) => !known.includes(name));
  // Help callers recover from a bad selection by reporting the eligible check and serve names.
  if (unknown !== undefined)
    return Effect.fail(new BadInput({ details: { id: unknown, flag: "only", known } }));
  const skipped = new Map<string, string>();
  for (const step of steps) {
    const reason = selectionSkip(step, options);
    if (reason !== undefined) skipped.set(step.name, reason);
  }
  const scope = options.only.length > 0 || options.skipTags.length > 0 ? "partial" : "full";
  return Effect.succeed({ steps, skipped, scope });
}
