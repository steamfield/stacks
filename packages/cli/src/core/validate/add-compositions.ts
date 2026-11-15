/**
 * Checks each validated fragment the way `stacks add` would apply it to an existing project.
 *
 * `stacks add` composes fragments (reusable additions such as CI or a database) onto a project
 * that already exists, and the brief it writes (the task text for the coding agent) has its own
 * add-mode sections and its own word budget. For every validated fragment, this check builds the
 * project each fitting stack's `new` would have produced (`canonicalHost`), then composes the
 * fragment onto it in add mode, in both presets, and once more onto a repository with no stack at
 * all. It reports a `compose-add` error when the fragment conflicts with that host, a `budget-add`
 * error when the merged add brief is over budget, and a `verify-run-duplicate` note when the
 * merged manifest (`.stacks/manifest.json`, the record of the project's verify steps) would run
 * one command twice.
 *
 * `index.ts` runs it during registry validation; the merge goes through the same
 * `add/manifest.ts::mergeAddManifest` and `brief/render.ts::renderBrief` that `stacks add` uses,
 * with the canonical render context from `budget.ts`. Start at `addCompositionChecks`.
 */
import type { Manifest } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { Finding } from "../../schemas/validate";
import { mergeAddManifest } from "../add/manifest";
import { renderBrief } from "../brief/render";
import { targetAgents } from "../compose/agents";
import { compose, mergeCommands, mergeEnv } from "../compose/compose";
import { fitsStack } from "../compose/selection";
import type { Composition } from "../compose/types";
import { buildManifest } from "../manifest";
import { type Entry, isFragment, isStack } from "../registry/entry";
import { canonicalContext, composedLimit } from "./budget";
import { uniqueFindings } from "./composed";
import { describe, replacementDefaults } from "./compositions";
import type { Check, View } from "./types";
import { duplicateRuns } from "./verify-notes";
import { entryFile, finding } from "./view";

type Preset = "default" | "sandbox";
type Agents = ReturnType<typeof targetAgents>;

/** Add-mode guidance has its own branches and budget, including repositories without a recipe. */
export const addCompositionChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const stacks = view.all.filter(isStack);
    for (const fragment of view.entries.filter(isFragment)) {
      const hosts = stacks.filter((stack) =>
        fitsStack(fragment.meta.appliesTo, { id: stack.id, tags: stack.meta.tags }),
      );
      for (const stack of [...hosts, null])
        for (const preset of ["default", "sandbox"] as const) {
          findings.push(...(yield* checkAddComposition(view, fragment, stack, preset)));
        }
    }
    return { findings: uniqueFindings(findings) };
  });

/** How findings name the case: `ci with go-cli` or `ci without a stack`. */
const hostLabel = (fragment: Entry, stack: Entry | null) =>
  `${fragment.id} ${stack ? `with ${stack.id}` : "without a stack"}`;

/** Compose the fragment onto one host in add mode and check the merged manifest and brief. */
const checkAddComposition = Effect.fn("validate.addComposition")(function* (
  view: View,
  fragment: Entry,
  stack: Entry | null,
  preset: Preset,
) {
  const agents = targetAgents(undefined, {});
  const previous = yield* canonicalHost(view, { fragment, stack, preset, agents });
  const applied = previous?.fragments.map((entry) => entry.id) ?? [];
  const result = yield* Effect.result(
    compose({
      stack: stack?.id ?? null,
      with: [fragment.id],
      without: [],
      preset,
      agents,
      always: [],
      mode: "add",
      existing: applied,
      ...(!stack ? { inferredTags: [] } : {}),
    }),
  );
  const subject = `${hostLabel(fragment, stack)} (${preset}, add)`;
  if (Result.isFailure(result)) {
    // Entry and reference checks already locate malformed prose and missing requirements.
    if (result.failure._tag !== "ComposeConflict") return [];
    return [
      finding(fragment, {
        check: "compose-add",
        severity: "error",
        file: entryFile(view, fragment),
        message: `${subject}: ${describe(result.failure).message}`,
      }),
    ];
  }
  const composition = result.success;
  const incoming = yield* buildManifest(composition, { briefWords: 0, mode: "add" });
  const { manifest } = mergeAddManifest({
    previous,
    incoming,
    name: "project",
    untrusted: false,
    agent: "none",
    stdinIsTTY: false,
  });
  const findings = duplicateRunNotes(view, { fragment, stack, incoming, manifest });
  if (addBriefWords(composition, { applied, stack, manifest }) > composedLimit(composition))
    findings.push(
      finding(fragment, {
        check: "budget-add",
        severity: "error",
        file: entryFile(view, fragment),
        message: `${subject}: add brief exceeds ${composedLimit(composition).toLocaleString("en-US")} words`,
      }),
    );
  return findings;
});

/** A note for each group of merged steps running one command, when the fragment added one. */
function duplicateRunNotes(
  view: View,
  {
    fragment,
    stack,
    incoming,
    manifest,
  }: { fragment: Entry; stack: Entry | null; incoming: Manifest; manifest: Manifest },
): Finding[] {
  const addedSteps = new Set(incoming.verify.map((step) => step.name));
  return duplicateRuns(manifest.verify)
    .filter((names) => names.some((name) => addedSteps.has(name)))
    .map((names) =>
      finding(fragment, {
        check: "verify-run-duplicate",
        severity: "note",
        file: entryFile(view, fragment),
        message: `${hostLabel(fragment, stack)} (add): steps ${names.join(", ")} run the same command in one composed manifest; keep both only if the repetition is intentional.`,
      }),
    );
}

/** The add brief's word count, rendered as `stacks add` would for a clean merge. */
function addBriefWords(
  composition: Composition<Entry | null>,
  { applied, stack, manifest }: { applied: string[]; stack: Entry | null; manifest: Manifest },
): number {
  const brief = renderBrief(
    { ...composition, untrusted: [] },
    {
      ...canonicalContext(composition),
      add: {
        applied,
        stack: stack?.id ?? null,
        mergeNeeded: [],
        missingRequired: [],
        digestRecorded: true,
        manifest,
      },
    },
  );
  return brief.briefWords;
}

/**
 * The manifest of the project the stack's `new` would have written, with the tested fragment left
 * out of it (and of its applied set) so adding it is a real addition. Undefined without a stack,
 * or when the stack's own composition fails, which ordinary composition checks report.
 */
const canonicalHost = Effect.fn("validate.addHost")(function* (
  view: View,
  {
    fragment,
    stack,
    preset,
    agents,
  }: { fragment: Entry; stack: Entry | null; preset: Preset; agents: Agents },
) {
  if (!stack || !isStack(stack)) return undefined;
  const result = yield* Effect.result(
    compose({
      stack: stack.id,
      with: [],
      without: replacementDefaults(view, stack, fragment.id),
      preset,
      agents,
      always: [],
      mode: "new",
    }),
  );
  if (Result.isFailure(result)) return undefined;
  const base = result.success;
  const fragments = base.fragments.filter((entry) => entry.id !== fragment.id);
  const entries = [base.stack, ...fragments];
  // A subset of a composition that merged cleanly can't conflict.
  const env = yield* Effect.orDie(mergeEnv(entries));
  return yield* buildManifest(
    {
      ...base,
      fragments,
      verify: base.verify.filter(
        (step) => step.owner.kind !== "fragment" || step.owner.id !== fragment.id,
      ),
      commands: mergeCommands(entries),
      env,
    },
    { briefWords: 0 },
  );
});
