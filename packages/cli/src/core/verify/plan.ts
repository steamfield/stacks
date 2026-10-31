import type { ManifestStep } from "@steamfield/stacks-format";
import { type Phase, type ResolvedStep, withStepDefaults } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { BadInput } from "../../errors";

export const PHASES: ReadonlyArray<Phase> = ["setup", "check", "serve", "teardown"];

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

/**
 * Orders the steps and applies the selection flags. `--only` and `--skip-tag` make the scope
 * `partial`; `skipByDefault` steps (`prod` under `--sandbox`) run with `--all` or an explicit
 * `--only` name. `--all` keeps the scope `full`. An `--only` name that is no check or serve step
 * is `BadInput`, listing those names.
 */
export function planVerify(
  manifestSteps: ReadonlyArray<ManifestStep>,
  options: SelectOptions,
): Effect.Effect<VerifyPlan, BadInput> {
  const resolved = manifestSteps.map(({ owner: _owner, skipByDefault, ...step }) => ({
    ...withStepDefaults(step),
    skipByDefault,
  }));
  const steps = [false, true].flatMap((app) =>
    PHASES.flatMap((phase) =>
      resolved.filter((step) => step.tags.includes("app") === app && step.phase === phase),
    ),
  );
  const selectable = steps.filter((step) => step.phase === "check" || step.phase === "serve");
  const known = selectable.map((step) => step.name).sort();
  const unknown = options.only.find((name) => !known.includes(name));
  if (unknown !== undefined)
    return Effect.fail(new BadInput({ details: { id: unknown, flag: "only", known } }));
  const skipped = new Map<string, string>();
  for (const step of steps) {
    const tag = step.tags.find((item) => options.skipTags.includes(item));
    if (step.skipByDefault && !options.all && !options.only.includes(step.name))
      skipped.set(step.name, "skipped by default in this preset; --all runs it");
    else if (
      options.only.length &&
      (step.phase === "check" || step.phase === "serve") &&
      !options.only.includes(step.name)
    )
      skipped.set(step.name, "not selected by --only");
    else if (tag !== undefined) skipped.set(step.name, `tagged ${tag}; --skip-tag leaves it out`);
  }
  const scope = options.only.length || options.skipTags.length ? "partial" : "full";
  return Effect.succeed({ steps, skipped, scope });
}
