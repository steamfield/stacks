import { APP_TAG, type FragmentMeta, type StackMeta } from "@steamfield/stacks-format";
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
import type { ComposeWarning, Composition } from "../compose/types";
import type { Entry } from "../registry/entry";
import { shellArg } from "../shell";
import { bodyLimit, canonicalBrief, composedLimit } from "./budget";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

const PRESETS = ["default", "sandbox"] as const;
type Preset = (typeof PRESETS)[number];
type Stack = Entry & { meta: StackMeta };
type ComposeFailure = NotFound | BadInput | EntryInvalid | ComposeConflict | PermissionDenied;
/** D7: the layers every stack's default composition verifies. */
const LAYERS = ["install", "lint", "typecheck", "test"] as const;
/** Stacks with these tags also need a `serve` step with a probe. */
const SERVED = ["web", "api"];

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

/** How a composition is named in findings and size rows: `go-cli (sandbox) + postgres`. */
const subject = (stack: string, preset: string, added?: string) =>
  `${stack} (${preset})${added === undefined ? "" : ` + ${added}`}`;

/** Defaults an explicit addition replaces; required fragments can never be dropped. */
export function replacementDefaults(view: Omit<View, "composed">, stack: Stack, id: string) {
  const fragment = (id: string) =>
    view.all.find(
      (entry): entry is Entry & { meta: FragmentMeta } =>
        "meta" in entry && entry.meta.kind === "fragment" && entry.id === id,
    );
  const added = fragment(id);
  return stack.meta.fragments.default.filter((other) => {
    if (stack.meta.fragments.required.includes(other)) return false;
    const existing = fragment(other);
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
  const fits = (meta: FragmentMeta) =>
    fitsStack(meta.appliesTo, { id: stack.id, tags: stack.meta.tags });
  const apps = view.all.flatMap((item) =>
    item.kind === "fragment" &&
    "meta" in item &&
    item.meta.kind === "fragment" &&
    item.meta.category === "app" &&
    fits(item.meta) &&
    view.inRoot(item)
      ? [item.id]
      : [],
  );
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
  const fragments = new Map(
    view.all.flatMap((item) =>
      item.kind === "fragment" && "meta" in item && item.meta.kind === "fragment"
        ? [[item.id, item.meta] as const]
        : [],
    ),
  );
  return [
    ...singles,
    ...extras.flatMap((first, index) =>
      extras.slice(index + 1).flatMap((second) => {
        const left = fragments.get(first);
        const right = fragments.get(second);
        if (
          !left ||
          !right ||
          (left.category === "app" && right.category === "app") ||
          left.conflicts.includes(second) ||
          right.conflicts.includes(first)
        )
          return [];
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
    ),
  ];
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
  const at = details.path
    ? ` at ${details.path}${details.line === undefined ? "" : `:${details.line}`}`
    : "";
  return {
    check: "compose",
    message: `${details.origin} entry ${details.id} is invalid (${details.reason}${details.problem ? `, ${details.problem}` : ""})${at}`,
  };
}

/**
 * Whether another check of this run already reports what made compose fail, so saying it again
 * would be noise: a validated entry's conditional markers or merged JSON, a fragment the load
 * checks rejected, or an id a validated entry names that `referenceChecks` found unknown.
 */
function reportedElsewhere(view: View, error: ComposeFailure): boolean {
  if (error._tag === "ComposeConflict") {
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
      !known &&
      view.entries.some((entry) => entry.kind === requirer.kind && entry.id === requirer.id)
    );
  }
  if (error._tag !== "EntryInvalid" || !error.details) return false;
  const { id, origin, reason } = error.details;
  if (
    view.rejected.some(
      (item) => item.kind === "fragment" && item.id === id && item.origin === origin,
    )
  )
    return true;
  return (
    (reason === "conditional" || reason === "merge_json") &&
    view.entries.some((entry) => entry.id === id && entry.origin === origin)
  );
}

type CompositionPlan = ReturnType<typeof compositionPlans>[number];
type CompositionCase = { stack: Stack; preset: Preset; plan: CompositionPlan };
type StackResults = {
  findings: Finding[];
  sizes: SizeRow[];
  missing: Map<string, Preset[]>;
  unlabeled: Set<string>;
  failed: Map<
    string,
    { check: string; added: string | undefined; message: string; presets: Preset[] }
  >;
  warned: Map<string, ComposeWarning & { added: string | undefined; presets: Preset[] }>;
};

/**
 * Each validated stack composed in each budgeted composition: a failure is a `compose` (or
 * `step-names`) error, a brief over its limit is `budget-composed`, and the default composition
 * must verify every D7 layer. Briefs are rendered with the canonical context; untrusted entries
 * get no special section.
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

const checkStackCompositions = (view: View, stack: Stack) =>
  Effect.gen(function* () {
    const agents = targetAgents(undefined, {});
    const missing = new Map<string, Preset[]>();
    // Missing layers that a step of the same name, with no layer, probably meant to cover.
    const unlabeled = new Set<string>();
    // One finding per failure, naming every preset it happened in.
    const failed = new Map<
      string,
      { check: string; added: string | undefined; message: string; presets: Preset[] }
    >();
    // Compose warnings, once per code and id, naming every preset they came up in.
    const warned = new Map<
      string,
      ComposeWarning & { added: string | undefined; presets: Preset[] }
    >();
    const state: StackResults = { findings: [], sizes: [], missing, unlabeled, failed, warned };
    const presets = view.composition ? [view.composition.preset] : PRESETS;
    for (const preset of presets) {
      const plans = view.composition
        ? [{ added: undefined, with: [], without: [] }]
        : compositionPlans(view, stack);
      for (const plan of plans) {
        const succeeded = yield* checkCompositionCase(view, { stack, preset, plan }, state, agents);
        // The added compositions fail the same way when the base one does.
        if (!succeeded && plan.added === undefined) break;
      }
    }
    reportStackFindings(view, stack, state);
    return { findings: state.findings, sizes: state.sizes };
  });

const checkCompositionCase = (
  view: View,
  { stack, preset, plan }: CompositionCase,
  state: StackResults,
  agents: Composition["agents"],
) =>
  Effect.gen(function* () {
    const composed = yield* Effect.result(
      view.composition
        ? Effect.succeed(view.composition)
        : compose({
            stack: stack.id,
            with: plan.with,
            without: plan.without,
            preset,
            agents,
            always: [],
            mode: "new",
          }),
    );
    if (Result.isFailure(composed)) {
      recordFailure(view, composed.failure, { preset, plan }, state);
      return false;
    }
    const composition = composed.success;
    // A preview's warnings come from the caller's --with and --without, not the stack's listing;
    // the preview returns them as warnings, as `new` does.
    if (!view.composition) recordWarnings(composition, { preset, plan }, state);
    recordBudget(view, composition, { stack, preset, plan }, state);
    recordMissingLayers(stack, composition, { preset, plan }, state);
    return true;
  });

function recordFailure(
  view: View,
  error: ComposeFailure,
  { preset, plan }: Pick<CompositionCase, "preset" | "plan">,
  state: StackResults,
) {
  if (!reportedElsewhere(view, error)) {
    const { check, message } = describe(error);
    const key = `${check}\0${plan.added ?? ""}\0${message}`;
    const prior = state.failed.get(key);
    if (prior) prior.presets.push(preset);
    else state.failed.set(key, { check, added: plan.added, message, presets: [preset] });
  }
}

function recordWarnings(
  composition: Composition,
  { preset, plan }: Pick<CompositionCase, "preset" | "plan">,
  state: StackResults,
) {
  for (const warning of composition.warnings) {
    const key = `${warning.code}\0${warning.id}`;
    const prior = state.warned.get(key);
    if (prior) prior.presets.push(preset);
    else state.warned.set(key, { ...warning, added: plan.added, presets: [preset] });
  }
}

function recordBudget(
  view: View,
  composition: Composition,
  { stack, preset, plan }: CompositionCase,
  state: StackResults,
) {
  const file = entryFile(view, stack);
  const name = subject(stack.id, preset, plan.added);
  const brief = canonicalBrief(composition);
  const limit = composedLimit(composition);
  state.sizes.push({
    kind: "composed",
    entryKind: "stack",
    entry: stack.id,
    preset,
    ...(plan.added === undefined ? {} : { with: plan.added }),
    words: brief.briefWords,
    fixedWords: brief.fixedWords,
    limit,
  });
  if (brief.briefWords > limit)
    state.findings.push(
      finding(stack, {
        check: "budget-composed",
        severity: "error",
        file,
        message: `${name}: ${brief.briefWords.toLocaleString("en-US")} words, limit ${limit.toLocaleString("en-US")}${previewHint(view, stack, preset, plan)}`,
      }),
    );
}

function previewHint(view: View, stack: Stack, preset: Preset, plan: CompositionPlan) {
  if (plan.with.length !== 2) return "";
  const args = [
    "stacks",
    "validate",
    ...(view.bundled ? [] : [view.root]),
    "--brief",
    stack.id,
    ...(preset === "sandbox" ? ["--sandbox"] : []),
    ...plan.with.flatMap((id) => ["--with", id]),
    ...plan.without.flatMap((id) => ["--without", id]),
  ];
  return `; preview: ${args.map(shellArg).join(" ")}`;
}

function recordMissingLayers(
  stack: Stack,
  composition: Composition,
  { preset, plan }: Pick<CompositionCase, "preset" | "plan">,
  state: StackResults,
) {
  if (plan.added === undefined)
    for (const layer of missingLayers(stack, composition)) {
      state.missing.set(layer, [...(state.missing.get(layer) ?? []), preset]);
      if (baseSteps(composition).some((step) => step.name === layer && step.layer === undefined))
        state.unlabeled.add(layer);
    }
}

function reportStackFindings(view: View, stack: Stack, state: StackResults) {
  const file = entryFile(view, stack);
  for (const { check, added, message, presets } of state.failed.values())
    state.findings.push(
      finding(stack, {
        check,
        severity: "error",
        file,
        message: `${subject(stack.id, presets.join(", "), added)}: ${message}`,
      }),
    );
  // The stack lists a fragment that doesn't fit it: an error, like any other broken listing.
  for (const { code, id, added, presets } of state.warned.values())
    state.findings.push(
      finding(stack, {
        check: code === "with_not_applicable" ? "optional-fits" : "compose",
        severity: "error",
        file,
        message:
          code === "with_not_applicable"
            ? `fragments.optional names ${id}, whose applies_to matches neither this stack nor its tags`
            : `${subject(stack.id, presets.join(", "), added)}: compose warns ${code.replaceAll("_", " ")}: ${id}`,
      }),
    );
  for (const [layer, presets] of state.missing)
    state.findings.push(
      finding(stack, {
        check: "verify-layers",
        severity: "error",
        file,
        message:
          layer === "serve"
            ? `no serve step with expect, which a stack tagged web or api needs (${presets.join(", ")})`
            : `no verify step with layer ${layer} (${presets.join(", ")})${state.unlabeled.has(layer) ? `; step ${layer} has no layer: add layer: ${layer} to it` : ""}`,
      }),
    );
}

/** The steps D7 counts: not an app's, and not skipped by default. */
const baseSteps = (composition: Composition) =>
  composition.verify.filter((step) => !step.tags.includes(APP_TAG) && !step.skipByDefault);

/** D7 layers the stack's own default composition doesn't cover; app steps don't count. */
function missingLayers(stack: Stack, composition: Composition): string[] {
  const steps = baseSteps(composition);
  const layers = new Set(steps.map((step) => step.layer));
  const missing: string[] = LAYERS.filter((layer) => !layers.has(layer));
  const served = steps.some((step) => step.phase === "serve" && step.expect);
  if (stack.meta.tags.some((tag) => SERVED.includes(tag)) && !served) missing.push("serve");
  return missing;
}
