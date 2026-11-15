/**
 * Composes each validated fragment with every stack it could land on, so a fragment author learns
 * about a conflict or an over-budget brief before a user does.
 *
 * A fragment (a reusable addition such as CI or a database) declares which stacks it fits
 * (`appliesTo`), and a stack (a recipe for a whole project) may list it as required, default or
 * optional. When `stacks validate` checks a fragment, `composeEachChecks` composes it onto every
 * stack that lists it, ships an overlay for it (a file meant only for that host stack) or fits it,
 * in both presets and for each coding-agent adapter the registry ships agent-only files for.
 *
 * Where a stack is itself being validated and lists the fragment, `compositions.ts` already checks
 * those compositions, so this file skips them. A conflict `composed.ts` already reported for the
 * same stack is skipped too (`RenderState.failures`). Findings are `budget-composed` or the compose
 * check's own name when the composition is one the stack is budgeted in, and `compose-each`
 * otherwise. `index.ts` runs this check over a registry; `preview.ts` leaves it out.
 */
import { AgentId, type FragmentMeta, type StackMeta } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { ComposeConflict } from "../../errors";
import type { Finding } from "../../schemas/validate";
import { compose } from "../compose/compose";
import { fitsStack } from "../compose/selection";
import type { ComposeOptions } from "../compose/types";
import { type Entry, isStack, shippedOnlyFor } from "../registry/entry";
import { canonicalBrief, composedLimit } from "./budget";
import { uniqueFindings } from "./composed";
import { compositionSingles, describe, replacementDefaults } from "./compositions";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

type Stack = Entry & { meta: StackMeta };
type Fragment = Entry & { meta: FragmentMeta };
/** How one fragment composes onto one stack; `budgeted` when the stack's own plans include it. */
type FragmentPlan = {
  budgeted: boolean;
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
};
type FragmentCase = {
  fragment: Fragment;
  stack: Stack;
  budgeted: boolean;
  options: ComposeOptions;
};

export const composeEachChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const stacks = view.all.filter(isStack);
    const agents = agentsWithOwnFiles(view);
    const fragments = view.entries.filter(
      (entry): entry is Fragment => entry.meta.kind === "fragment",
    );
    for (const fragment of fragments)
      for (const stack of stacks)
        findings.push(...(yield* composeFragmentPair(view, { fragment, stack, agents })));
    return { findings: uniqueFindings(findings) };
  });

/** Agents any loaded entry ships agent-only files for. */
function agentsWithOwnFiles(view: View): AgentId[] {
  return AgentId.literals.filter((agent) =>
    [...view.sources.values()].some((sources) =>
      sources.files.some((file) => shippedOnlyFor(file.source, "agent", agent)),
    ),
  );
}

/**
 * How to compose the fragment onto the stack, or undefined when the pair is out of scope: the
 * stack neither lists, hosts an overlay of nor fits the fragment, or `compositionChecks` already
 * covers the pair because the stack is validated too and budgets the fragment.
 */
function fragmentPlan(view: View, stack: Stack, fragment: Fragment): FragmentPlan | undefined {
  const listed = Object.values(stack.meta.fragments).some((ids) => ids.includes(fragment.id));
  if (!listed && !hostsOverlay(view, stack, fragment) && !fitsByAppliesTo(stack, fragment))
    return undefined;
  const inBase = [...stack.meta.fragments.required, ...stack.meta.fragments.default].includes(
    fragment.id,
  );
  const plan = compositionSingles(view, stack).find((plan) =>
    inBase ? plan.added === undefined : plan.added === fragment.id,
  );
  const budgeted = listed || plan !== undefined;
  if (budgeted && view.entries.some((entry) => entry.dir === stack.dir)) return undefined;
  const without = plan?.without ?? replacementDefaults(view, stack, fragment.id);
  return { budgeted, with: plan?.with ?? [fragment.id], without };
}

function hostsOverlay(view: View, stack: Stack, fragment: Fragment): boolean {
  return (
    view.sources
      .get(fragment.dir)
      ?.files.some((file) => shippedOnlyFor(file.source, "stack", stack.id)) ?? false
  );
}

/** An empty `appliesTo` fits nothing here: only a listing or overlay brings such a fragment in. */
function fitsByAppliesTo(stack: Stack, fragment: Fragment): boolean {
  return (
    fragment.meta.appliesTo.length > 0 &&
    fitsStack(fragment.meta.appliesTo, { id: stack.id, tags: stack.meta.tags })
  );
}

/** Every adapter and preset of one fragment and stack pair. */
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

const checkFragmentComposition = (view: View, check: FragmentCase) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(compose(check.options));
    if (Result.isSuccess(result)) {
      const limit = composedLimit(result.success);
      if (canonicalBrief(result.success).briefWords <= limit) return [];
      return [
        fragmentFinding(view, check, {
          check: check.budgeted ? "budget-composed" : "compose-each",
          message: `composed brief exceeds ${limit.toLocaleString("en-US")} words`,
        }),
      ];
    }
    const error = result.failure;
    // The entry and reference checks own invalid inputs.
    if (error._tag !== "ComposeConflict") return [];
    if (yield* reportedWhileRendering(view, check.stack, error)) return [];
    const described = describe(error);
    return [
      fragmentFinding(view, check, {
        check: check.budgeted ? described.check : "compose-each",
        message: described.message,
      }),
    ];
  });

/** Whether `composed.ts` already reported this conflict for the stack. */
const reportedWhileRendering = (view: View, stack: Stack, error: ComposeConflict) =>
  Effect.map(view.composed, ({ failures }) =>
    failures.has(JSON.stringify([stack.id, error.details])),
  );

function fragmentFinding(
  view: View,
  { fragment, stack }: FragmentCase,
  { check, message }: { check: string; message: string },
): Finding {
  return finding(fragment, {
    check,
    severity: "error",
    file: entryFile(view, fragment),
    message: `${fragment.id} with ${stack.id}: ${message}`,
  });
}
