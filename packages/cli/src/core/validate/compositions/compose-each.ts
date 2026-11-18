/**
 * Checks a fragment with each eligible host so authors see conflicts before users do. It skips
 * plans covered by `compositionChecks` and conflicts already in `RenderState.failures`.
 */
import { AgentId } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { ComposeConflict } from "../../../errors";
import type { Finding } from "../../../schemas/validate";
import { compose } from "../../compose/compose";
import type { ComposeOptions } from "../../compose/types";
import { type Fragment, isStack, type Stack, shippedOnlyFor } from "../../registry/entry";
import type { Check, View } from "../types";
import { entryFile, finding } from "../view";
import { uniqueFindings } from "./composed";
import {
  compositionSingles,
  describe,
  fitsHost,
  replacementDefaults,
  stackHosts,
} from "./compositions";

/** How one fragment composes onto one stack; `covered` when the stack's own plans include it. */
type FragmentPlan = {
  covered: boolean;
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
};
type FragmentCase = {
  fragment: Fragment;
  stack: Stack;
  covered: boolean;
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
 * covers the pair because the stack is validated too and its plans include the fragment.
 */
function fragmentPlan(view: View, stack: Stack, fragment: Fragment): FragmentPlan | undefined {
  const listed = Object.values(stack.meta.fragments).some((ids) => ids.includes(fragment.id));
  if (!listed && !hostsOverlay(view, stack, fragment) && !fitsByAppliesTo(view, stack, fragment))
    return undefined;
  const inBase = [...stack.meta.fragments.required, ...stack.meta.fragments.default].includes(
    fragment.id,
  );
  const plan = compositionSingles(view, stack).find((plan) =>
    inBase ? plan.added === undefined : plan.added === fragment.id,
  );
  const covered = listed || plan !== undefined;
  if (covered && view.entries.some((entry) => entry.dir === stack.dir)) return undefined;
  const without = plan?.without ?? replacementDefaults(view, stack, fragment.id);
  return { covered, with: plan?.with ?? [fragment.id], without };
}

/** Whether the fragment ships an overlay for the stack or, for a workspace, one of its parts. */
function hostsOverlay(view: View, stack: Stack, fragment: Fragment): boolean {
  const hosts = stackHosts(view, stack).map((host) => host.id);
  return (
    view.sources
      .get(fragment.dir)
      ?.files.some((file) => hosts.some((id) => shippedOnlyFor(file.source, "stack", id))) ?? false
  );
}

/**
 * Fits the stack or, for a workspace, one of its parts. An empty `appliesTo` fits nothing here:
 * only a listing or overlay brings such a fragment in.
 */
function fitsByAppliesTo(view: View, stack: Stack, fragment: Fragment): boolean {
  return fragment.meta.appliesTo.length > 0 && fitsHost(view, stack, fragment.meta.appliesTo);
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
            covered: plan.covered,
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

const checkFragmentComposition = Effect.fn("validate.fragmentComposition")(function* (
  view: View,
  check: FragmentCase,
) {
  const result = yield* Effect.result(compose(check.options));
  if (Result.isSuccess(result)) return [];
  const error = result.failure;
  // The entry and reference checks own invalid inputs.
  if (error._tag !== "ComposeConflict") return [];
  if (yield* reportedWhileRendering(view, check.stack, error)) return [];
  const described = describe(error);
  // Keep the regular compose check id for cases covered by the stack's own plans.
  return [
    fragmentFinding(view, check, {
      check: check.covered ? described.check : "compose-each",
      message: described.message,
    }),
  ];
});

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
