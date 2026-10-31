import { AgentId, type FragmentMeta, type StackMeta } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { Finding } from "../../schemas/validate";
import { type ComposeOptions, compose } from "../compose/compose";
import { fitsStack } from "../compose/selection";
import { type Entry, isStack, shippedPath } from "../registry/entry";
import { canonicalBrief, composedLimit } from "./budget";
import { uniqueFindings } from "./composed";
import { compositionSingles, describe, replacementDefaults } from "./compositions";
import { type Check, entryFile, finding, type View } from "./view";

type Stack = Entry & { meta: StackMeta };
type Fragment = Entry & { meta: FragmentMeta };

export const composeEachChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const stacks = view.all.filter(isStack);
    const agents = AgentId.literals.filter((agent) =>
      [...view.sources.values()].some((sources) =>
        sources.files.some((file) => {
          const condition = shippedPath(file.source)?.condition;
          return condition?.kind === "agent" && condition.id === agent;
        }),
      ),
    );
    const fragments = view.entries.filter(
      (entry): entry is Fragment => entry.meta.kind === "fragment",
    );
    for (const fragment of fragments)
      for (const stack of stacks)
        findings.push(...(yield* composeFragmentPair(view, { fragment, stack, agents })));
    return { findings: uniqueFindings(findings) };
  });

function fragmentPlan(view: View, stack: Stack, fragment: Fragment) {
  const listed = Object.values(stack.meta.fragments).some((ids) => ids.includes(fragment.id));
  const overlay = view.sources.get(fragment.dir)?.files.some((file) => {
    const condition = shippedPath(file.source)?.condition;
    return condition?.kind === "stack" && condition.id === stack.id;
  });
  if (
    !listed &&
    !overlay &&
    (!fragment.meta.appliesTo.length ||
      !fitsStack(fragment.meta.appliesTo, { id: stack.id, tags: stack.meta.tags }))
  )
    return undefined;
  const inBase = [...stack.meta.fragments.required, ...stack.meta.fragments.default].includes(
    fragment.id,
  );
  const plan = compositionSingles(view, stack).find((plan) =>
    inBase ? plan.added === undefined : plan.added === fragment.id,
  );
  const budgeted = listed || plan !== undefined;
  // 1.5 owns listed fragments and apps when the stack itself is being validated.
  if (budgeted && view.entries.some((entry) => entry.dir === stack.dir)) return undefined;
  const without = plan?.without ?? replacementDefaults(view, stack, fragment.id);
  return { budgeted, with: plan?.with ?? [fragment.id], without };
}

const composeFragmentPair = (
  view: View,
  { fragment, stack, agents }: { fragment: Fragment; stack: Stack; agents: ReadonlyArray<AgentId> },
) =>
  Effect.gen(function* () {
    const plan = fragmentPlan(view, stack, fragment);
    const findings: Finding[] = [];
    if (!plan) return findings;
    for (const targets of agents.length ? agents.map((agent) => [agent]) : [[]])
      for (const preset of ["default", "sandbox"] as const)
        findings.push(
          ...(yield* checkFragmentComposition(view, {
            fragment,
            stack,
            budgeted: plan.budgeted,
            options: {
              stack: stack.id,
              with: plan.with,
              without: plan.without,
              preset,
              agents: targets,
              always: [],
              mode: "new",
            },
          })),
        );
    return findings;
  });

const checkFragmentComposition = (
  view: View,
  {
    fragment,
    stack,
    budgeted,
    options,
  }: { fragment: Fragment; stack: Stack; budgeted: boolean; options: ComposeOptions },
) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const result = yield* Effect.result(compose(options));
    if (Result.isSuccess(result)) {
      const limit = composedLimit(result.success);
      if (canonicalBrief(result.success).briefWords > limit)
        findings.push(
          finding(fragment, {
            check: budgeted ? "budget-composed" : "compose-each",
            severity: "error",
            file: entryFile(view, fragment),
            message: `${fragment.id} with ${stack.id}: composed brief exceeds ${limit.toLocaleString("en-US")} words`,
          }),
        );
      return findings;
    }
    const error = result.failure;
    if (error._tag !== "ComposeConflict") return findings; // The entry/reference checks own invalid inputs.
    if ((yield* view.composed).failures.has(JSON.stringify([stack.id, error.details])))
      return findings;
    findings.push(
      finding(fragment, {
        check: budgeted ? describe(error).check : "compose-each",
        severity: "error",
        file: entryFile(view, fragment),
        message: `${fragment.id} with ${stack.id}: ${describe(error).message}`,
      }),
    );
    return findings;
  });
