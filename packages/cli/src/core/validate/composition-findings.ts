/**
 * Groups recurring problems across a stack’s compositions so each problem gets one finding.
 * `missingLayers` defines the required checks, including an expect probe for web and API stacks.
 */
import { APP_TAG } from "@steamfield/stacks-format";
import type { Finding, SizeRow } from "../../schemas/validate";
import type { ComposeWarning, Composition } from "../compose/types";
import { canonicalBrief, composedLimit } from "./budget";
import type { PlanShape, Preset, Stack, View } from "./types";
import { entryFile, finding } from "./view";

type Occurrence = { preset: Preset; plan: PlanShape };

/** The layers every stack's default composition verifies. */
const LAYERS = ["install", "lint", "typecheck", "test"] as const;
/** Stacks with these tags also need a `serve` step with a probe. */
const SERVED = ["web", "api"];

type FailureGroup = {
  check: string;
  added: string | undefined;
  message: string;
  presets: Preset[];
};
type WarningGroup = ComposeWarning & { added: string | undefined; presets: Preset[] };

export type StackResults = {
  /** Over-budget findings, written as each composition is checked. */
  findings: Finding[];
  sizes: SizeRow[];
  /** Missing layers, with the presets each is missing in. */
  missing: Map<string, Preset[]>;
  /** Missing layers that a step of the same name, with no layer, probably meant to cover. */
  unlabeled: Set<string>;
  /** One entry per failure, naming every preset it happened in. */
  failed: Map<string, FailureGroup>;
  /** Compose warnings, once per code and id, naming every preset they came up in. */
  warned: Map<string, WarningGroup>;
};

export function emptyResults(): StackResults {
  return {
    findings: [],
    sizes: [],
    missing: new Map(),
    unlabeled: new Set(),
    failed: new Map(),
    warned: new Map(),
  };
}

/** How a composition is named in findings: `go-cli (sandbox) + postgres`. */
const subject = (stack: string, preset: string, added?: string) =>
  `${stack} (${preset})${added === undefined ? "" : ` + ${added}`}`;

export function recordFailure(
  state: StackResults,
  failure: { check: string; message: string },
  { preset, plan }: Occurrence,
) {
  const { check, message } = failure;
  const key = `${check}\0${plan.added ?? ""}\0${message}`;
  const prior = state.failed.get(key);
  if (prior) prior.presets.push(preset);
  else state.failed.set(key, { check, added: plan.added, message, presets: [preset] });
}

export function recordWarnings(
  state: StackResults,
  composition: Composition,
  { preset, plan }: Occurrence,
) {
  for (const warning of composition.warnings) {
    const key = `${warning.code}\0${warning.id}`;
    const prior = state.warned.get(key);
    if (prior) prior.presets.push(preset);
    else state.warned.set(key, { ...warning, added: plan.added, presets: [preset] });
  }
}

/** Budget only defaults; explicit previews keep their counts in `previewResult`. */
export function recordBudget(
  state: StackResults,
  { view, stack, composition }: { view: View; stack: Stack; composition: Composition },
  { preset, plan }: Occurrence,
) {
  const options = view.composition?.options ?? plan;
  if (options.with.length || options.without.length) return;
  const brief = canonicalBrief(composition);
  const limit = composedLimit(composition);
  state.sizes.push({
    kind: "composed",
    entryKind: "stack",
    entry: stack.id,
    preset,
    words: brief.briefWords,
    fixedWords: brief.fixedWords,
    limit,
  });
  if (brief.briefWords <= limit) return;
  const name = subject(stack.id, preset);
  state.findings.push(
    finding(stack, {
      check: "budget-composed",
      severity: "error",
      file: entryFile(view, stack),
      message: `${name}: ${brief.briefWords.toLocaleString("en-US")} words, limit ${limit.toLocaleString("en-US")}`,
    }),
  );
}

/** Note the layers the base composition doesn't verify; added compositions aren't held to it. */
export function recordMissingLayers(
  state: StackResults,
  { stack, composition }: { stack: Stack; composition: Composition },
  { preset, plan }: Occurrence,
) {
  if (plan.added !== undefined) return;
  for (const layer of missingLayers(stack, composition)) {
    state.missing.set(layer, [...(state.missing.get(layer) ?? []), preset]);
    if (baseSteps(composition).some((step) => step.name === layer && step.layer === undefined))
      state.unlabeled.add(layer);
  }
}

/** The steps the layer rule counts: not an app's, and not skipped by default. */
const baseSteps = (composition: Composition) =>
  composition.verify.filter((step) => !step.tags.includes(APP_TAG) && !step.skipByDefault);

function missingLayers(stack: Stack, composition: Composition): string[] {
  const steps = baseSteps(composition);
  const layers = new Set(steps.map((step) => step.layer));
  const missing: string[] = LAYERS.filter((layer) => !layers.has(layer));
  const served = steps.some((step) => step.phase === "serve" && step.expect);
  if (stack.meta.tags.some((tag) => SERVED.includes(tag)) && !served) missing.push("serve");
  return missing;
}

/** Returns user-facing messages, with budgets first, then failures, warnings and missing layers. */
export function stackFindings(view: View, stack: Stack, state: StackResults): Finding[] {
  const file = entryFile(view, stack);
  const error = (fields: { check: string; message: string }) =>
    finding(stack, { ...fields, severity: "error", file });
  return [
    ...state.findings,
    ...[...state.failed.values()].map(({ check, added, message, presets }) =>
      error({ check, message: `${subject(stack.id, presets.join(", "), added)}: ${message}` }),
    ),
    ...[...state.warned.values()].map((group) => error(warningFinding(stack, group))),
    ...[...state.missing].map(([layer, presets]) =>
      error({ check: "verify-layers", message: layerMessage(layer, presets, state) }),
    ),
  ];
}

/** A warning about the stack's own listing is an error, like any other broken listing. */
function warningFinding(stack: Stack, { code, id, added, presets }: WarningGroup) {
  if (code === "with_not_applicable")
    return {
      check: "optional-fits",
      message: `fragments.optional names ${id}, whose applies_to matches neither this stack nor its tags`,
    };
  return {
    check: "compose",
    message: `${subject(stack.id, presets.join(", "), added)}: compose warns ${code.replaceAll("_", " ")}: ${id}`,
  };
}

function layerMessage(layer: string, presets: ReadonlyArray<Preset>, state: StackResults) {
  if (layer === "serve")
    return `no serve step with expect, which a stack tagged web or api needs (${presets.join(", ")})`;
  const hint = state.unlabeled.has(layer)
    ? `; step ${layer} has no layer: add layer: ${layer} to it`
    : "";
  return `no verify step with layer ${layer} (${presets.join(", ")})${hint}`;
}
