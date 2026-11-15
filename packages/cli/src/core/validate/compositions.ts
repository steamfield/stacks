/**
 * The word-budget and composition checks `stacks validate` runs for every stack it validates.
 *
 * A composition is what a stack (a recipe for a whole project) becomes once fragments (reusable
 * additions such as CI or a database) are combined onto it: files, verify steps and a brief, the
 * task text the coding agent reads. An author can only see one composition at a time with
 * `stacks new`, so this file builds the ones a user is likely to get and checks each:
 * `compositionPlans` lists them (the defaults, each extra fragment alone, each compatible pair,
 * in both the `default` and `sandbox` presets), `compositionChecks` composes each through
 * `compose/compose.ts::compose` and records failures, compose warnings, over-budget briefs and
 * missing verify layers in `composition-findings.ts`. `bodyChecks` holds each entry's own body to
 * its limit from `budget.ts`.
 *
 * `index.ts` runs both checks over a registry; `preview.ts` runs `compositionChecks` over the one
 * composition `validate --brief` previews (`View.composition`). `composed.ts`, `compose-each.ts`
 * and `add-compositions.ts` reuse the plans, and `describe` turns a compose failure into the one
 * line every one of them reports. Start at `compositionChecks`.
 */
import type { FragmentMeta } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type {
  BadInput,
  ComposeConflict,
  EntryInvalid,
  NotFound,
  PermissionDenied,
} from "../../errors";
import type { Finding, SizeRow } from "../../schemas/validate";
import { countWords } from "../brief/words";
import { targetAgents } from "../compose/agents";
import { compose } from "../compose/compose";
import { fitsStack } from "../compose/selection";
import type { Composition } from "../compose/types";
import { type Entry, isFragment, isRejected, type RejectedEntry } from "../registry/entry";
import { bodyLimit } from "./budget";
import {
  emptyResults,
  recordBudget,
  recordFailure,
  recordMissingLayers,
  recordWarnings,
  type StackResults,
  stackFindings,
} from "./composition-findings";
import { type Check, type PlanShape, PRESETS, type Preset, type Stack, type View } from "./types";
import { entryFile, finding } from "./view";

type ComposeFailure = NotFound | BadInput | EntryInvalid | ComposeConflict | PermissionDenied;
type Fragment = Entry & { meta: FragmentMeta };

/** Each entry's own body against its limit (stack, fragment or app), every branch counted. */
export const bodyChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    const sizes: SizeRow[] = [];
    for (const entry of view.entries) {
      const words = countWords(entry.body);
      const limit = bodyLimit(entry);
      sizes.push({ kind: "body", entryKind: entry.kind, entry: entry.id, words, limit });
      if (words > limit)
        findings.push(
          finding(entry, {
            check: "budget-body",
            severity: "error",
            file: entryFile(view, entry),
            message: `body is ${words.toLocaleString("en-US")} words, limit ${limit.toLocaleString("en-US")}`,
          }),
        );
    }
    return { findings, sizes };
  });

/** A fragment that loaded, found by its directory kind as well as its metadata. */
function isLoadedFragment(item: Entry | RejectedEntry): item is Fragment {
  return item.kind === "fragment" && !isRejected(item) && isFragment(item);
}

function findFragment(view: Omit<View, "composed">, id: string): Fragment | undefined {
  return view.all.find(
    (entry): entry is Fragment => !isRejected(entry) && isFragment(entry) && entry.id === id,
  );
}

/** Defaults an explicit addition replaces; required fragments can never be dropped. */
export function replacementDefaults(view: Omit<View, "composed">, stack: Stack, id: string) {
  const added = findFragment(view, id);
  return stack.meta.fragments.default.filter((other) => {
    if (stack.meta.fragments.required.includes(other)) return false;
    const existing = findFragment(view, other);
    // A composition holds at most one app, and declared conflicts hold in either direction.
    return (
      (added?.meta.category === "app" && existing?.meta.category === "app") ||
      (added?.meta.conflicts.includes(other) ?? false) ||
      (existing?.meta.conflicts.includes(id) ?? false)
    );
  });
}

/** Default and single-extra plans, also used by the per-fragment rot check. */
export function compositionSingles(view: Omit<View, "composed">, stack: Stack) {
  const { required, optional } = stack.meta.fragments;
  const defaults = stack.meta.fragments.default;
  const apps = fittingApps(view, stack);
  // Rejected fragments count as known here: their own load finding already reports them.
  const known = new Set(view.all.filter((item) => item.kind === "fragment").map((item) => item.id));
  const extras = [...new Set([...optional.filter((id) => known.has(id)), ...apps])]
    .filter((id) => !required.includes(id) && !defaults.includes(id))
    .sort();
  return [
    { added: undefined, with: [], without: [] },
    ...extras.map((id) => ({
      added: id,
      with: [id],
      without: replacementDefaults(view, stack, id),
    })),
  ];
}

/** Apps under the validated root that fit the stack, so plans don't depend on this machine. */
function fittingApps(view: Omit<View, "composed">, stack: Stack): string[] {
  const fits = (meta: FragmentMeta) =>
    fitsStack(meta.appliesTo, { id: stack.id, tags: stack.meta.tags });
  return view.all.flatMap((item) =>
    isLoadedFragment(item) && item.meta.category === "app" && fits(item.meta) && view.inRoot(item)
      ? [item.id]
      : [],
  );
}

/**
 * The compositions each validated stack is budgeted in: its required and default fragments (with
 * any default app), each extra on its own, then each compatible unordered pair, all in both
 * presets. Apps come from the validated root (or the stack's own `optional`), so the
 * compositions don't depend on what else this machine holds. An added fragment replaces the
 * defaults it conflicts with, in either direction, and an added app replaces default apps, since
 * one composition holds at most one. Two apps or mutually conflicting fragments cannot be
 * paired. An optional id that names no fragment is `referenceChecks`'.
 */
export function compositionPlans(view: Omit<View, "composed">, stack: Stack) {
  const singles = compositionSingles(view, stack);
  const extras = singles.flatMap((plan) => (plan.added === undefined ? [] : [plan.added]));
  return [...singles, ...pairPlans(view, stack, extras)];
}

/** Every unordered pair of extras that may share a composition, in `extras` order. */
function pairPlans(view: Omit<View, "composed">, stack: Stack, extras: ReadonlyArray<string>) {
  const fragments = new Map(
    view.all.flatMap((item) => (isLoadedFragment(item) ? [[item.id, item.meta] as const] : [])),
  );
  return extras.flatMap((first, index) =>
    extras.slice(index + 1).flatMap((second) => {
      const left = fragments.get(first);
      const right = fragments.get(second);
      if (!left || !right || !canPair(left, right, [first, second])) return [];
      return [
        {
          added: `${first} + ${second}`,
          with: [first, second],
          without: [
            ...new Set([
              ...replacementDefaults(view, stack, first),
              ...replacementDefaults(view, stack, second),
            ]),
          ],
        },
      ];
    }),
  );
}

/** Two fragments can share a composition unless both are apps or one conflicts with the other. */
function canPair(left: FragmentMeta, right: FragmentMeta, [first, second]: [string, string]) {
  if (left.category === "app" && right.category === "app") return false;
  return !left.conflicts.includes(second) && !right.conflicts.includes(first);
}

/** A compose failure as one line: what failed and the ids involved, never file content. */
export function describe(error: ComposeFailure): { check: string; message: string } {
  switch (error._tag) {
    case "ComposeConflict":
      return describeConflict(error);
    case "EntryInvalid":
      return describeInvalid(error);
    case "PermissionDenied":
      return {
        check: "compose",
        message: `a file is unreadable${error.details?.path ? `: ${error.details.path}` : ""}`,
      };
    case "NotFound":
      return { check: "compose", message: "an id named in the composition resolves to nothing" };
    case "BadInput":
      return { check: "compose", message: "the composition's flags contradict each other" };
  }
}

function describeConflict(error: ComposeConflict): { check: string; message: string } {
  const details = error.details;
  if (!details) return { check: "compose", message: "can't compose" };
  const parties = [...(details.stack ? [details.stack] : []), ...details.ids].join(", ");
  const what = details.path ?? details.step ?? details.key;
  return {
    check: details.reason === "step_name" ? "step-names" : "compose",
    message: `can't compose (${details.reason}): ${parties}${what ? `; ${what}` : ""}`,
  };
}

function describeInvalid(error: EntryInvalid): { check: string; message: string } {
  const details = error.details;
  if (!details) return { check: "compose", message: "an entry is invalid" };
  const reason = details.problem ? `${details.reason}, ${details.problem}` : details.reason;
  const line = details.line === undefined ? "" : `:${details.line}`;
  const at = details.path ? ` at ${details.path}${line}` : "";
  return {
    check: "compose",
    message: `${details.origin} entry ${details.id} is invalid (${reason})${at}`,
  };
}

/**
 * Whether another check of this run already reports what made compose fail, so saying it again
 * would be noise: a validated entry's conditional markers or merged JSON, a fragment the load
 * checks rejected, or an id a validated entry names that `referenceChecks` found unknown.
 */
function reportedElsewhere(view: View, error: ComposeFailure): boolean {
  if (error._tag === "ComposeConflict") return unknownRequirementReported(view, error);
  if (error._tag === "EntryInvalid") return invalidEntryReported(view, error);
  return false;
}

/** A `requires` edge to an unknown fragment, named by a validated entry. */
function unknownRequirementReported(view: View, error: ComposeConflict): boolean {
  const details = error.details;
  if (details?.reason !== "requires") return false;
  // A requires edge: the stack (or the first fragment) names the last id.
  const target = details.ids.at(-1);
  const requirer =
    details.stack !== undefined
      ? { kind: "stack", id: details.stack }
      : { kind: "fragment", id: details.ids[0] };
  const known = view.all.some((item) => item.kind === "fragment" && item.id === target);
  return (
    !known && view.entries.some((entry) => entry.kind === requirer.kind && entry.id === requirer.id)
  );
}

/** A rejected fragment, or a validated entry's conditional or merged-JSON defect. */
function invalidEntryReported(view: View, error: EntryInvalid): boolean {
  if (!error.details) return false;
  const { id, origin, reason } = error.details;
  const rejected = view.rejected.some(
    (item) => item.kind === "fragment" && item.id === id && item.origin === origin,
  );
  if (rejected) return true;
  return (
    (reason === "conditional" || reason === "merge_json") &&
    view.entries.some((entry) => entry.id === id && entry.origin === origin)
  );
}

/**
 * Each validated stack composed in each budgeted composition: a failure is a `compose` (or
 * `step-names`) error, a brief over its limit is `budget-composed`, and the default composition
 * must verify every layer (`install`, `lint`, `typecheck`, `test`). Briefs are rendered with the
 * canonical context; untrusted entries get no special section.
 */
export const compositionChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const sizes: SizeRow[] = [];
    const stacks = view.entries.filter((entry): entry is Stack => entry.meta.kind === "stack");
    for (const stack of stacks) {
      const checked = yield* checkStackCompositions(view, stack);
      findings.push(...checked.findings);
      sizes.push(...checked.sizes);
    }
    return { findings, sizes };
  });

const PREVIEW_PLAN: PlanShape = { added: undefined, with: [], without: [] };

/**
 * A preview checks its one composition (already composed, with the caller's flags) in its own
 * preset; registry validation checks every plan in both presets.
 */
function plansToCheck(view: View, stack: Stack) {
  if (view.composition)
    return { presets: [view.composition.preset], plans: [PREVIEW_PLAN] } as const;
  return { presets: PRESETS, plans: compositionPlans(view, stack) } as const;
}

const checkStackCompositions = (view: View, stack: Stack) =>
  Effect.gen(function* () {
    const agents = targetAgents(undefined, {});
    const state = emptyResults();
    const { presets, plans } = plansToCheck(view, stack);
    for (const preset of presets) {
      for (const plan of plans) {
        const succeeded = yield* checkComposition(view, { stack, preset, plan, agents }, state);
        // The added compositions fail the same way when the base one does.
        if (!succeeded && plan.added === undefined) break;
      }
    }
    return { findings: stackFindings(view, stack, state), sizes: state.sizes };
  });

type CompositionCase = {
  stack: Stack;
  preset: Preset;
  plan: PlanShape;
  agents: Composition["agents"];
};

/** Compose one plan and record what it shows; false when it didn't compose. */
const checkComposition = (view: View, check: CompositionCase, state: StackResults) =>
  Effect.gen(function* () {
    const { stack, preset, plan } = check;
    const composed = yield* Effect.result(composeCase(view, check));
    if (Result.isFailure(composed)) {
      if (!reportedElsewhere(view, composed.failure))
        recordFailure(state, describe(composed.failure), { preset, plan });
      return false;
    }
    const composition = composed.success;
    // A preview's warnings come from the caller's --with and --without, not the stack's listing;
    // the preview returns them as warnings, as `new` does.
    if (!view.composition) recordWarnings(state, composition, { preset, plan });
    recordBudget(state, { view, stack, composition }, { preset, plan });
    recordMissingLayers(state, { stack, composition }, { preset, plan });
    return true;
  });

function composeCase(view: View, { stack, preset, plan, agents }: CompositionCase) {
  if (view.composition) return Effect.succeed(view.composition);
  return compose({
    stack: stack.id,
    with: plan.with,
    without: plan.without,
    preset,
    agents,
    always: [],
    mode: "new",
  });
}
