/**
 * Decides which of a project's verify steps a `stacks verify` run will execute, and in what order.
 *
 * A verify step is one command from the manifest (`.stacks/manifest.json`), with a phase: `setup`
 * prepares, `check` tests, `serve` starts a server and probes it, `teardown` cleans up. Steps tagged
 * `app` form a second stage that runs after the base steps. `planVerify` puts the steps in run
 * order (base then app, each by phase, then manifest order) and applies the selection flags
 * (`--only`, `--skip-tag`, `--all`), recording a fixed reason for every step it leaves out.
 * Selection never skips setup or teardown, because the checks depend on them.
 *
 * `commands/verify.ts` calls `planVerify` to reject a bad `--only` name early and to build a
 * `changed` result; `run.ts::runVerify` plans again and runs the plan. Nothing here touches the
 * project or runs a process.
 */
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

/** A manifest step with its defaults applied. */
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

/** The result of a step that didn't run, with the fixed reason it was skipped. */
export const skippedStep = (step: PlannedStep, reason: string): StepResult => ({
  ...stepFields(step),
  status: "skipped",
  durationMs: 0,
  reason,
});

/** Whether the step belongs to the app stage, which runs after the base steps. */
export const isAppStep = (step: PlannedStep) => step.tags.includes("app");

/** Only check and serve steps can be picked with `--only`; setup and teardown always run. */
const isSelectable = (step: PlannedStep) => step.phase === "check" || step.phase === "serve";

/**
 * Applies the manifest's defaults. A `hygiene`-tagged step is skipped by default like a step the
 * preset marked (`prod` under `--sandbox`). `owner` only says which entry contributed the step.
 */
const resolveStep = ({ owner: _owner, skipByDefault, ...step }: ManifestStep): PlannedStep => {
  const defaults = withStepDefaults(step);
  return { ...defaults, skipByDefault: skipByDefault || defaults.tags.includes(HYGIENE_TAG) };
};

/** Base steps then app steps, each grouped by phase, keeping manifest order within a group. */
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
 * Orders the steps and applies the selection flags. `--only` and `--skip-tag` make the scope
 * `partial`; `skipByDefault` steps (`prod` under `--sandbox`, and every `hygiene` step) run with
 * `--all` or an explicit `--only` name. `--all` keeps the scope `full`. An `--only` name that is
 * no check or serve step is `BadInput`, listing those names.
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
