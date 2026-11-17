/**
 * Checks fragment additions against canonical hosts and a repository without a stack. It
 * exercises the production `mergeAddManifest` and `renderBrief` with canonical inputs.
 */
import type { Manifest } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { Finding } from "../../../schemas/validate";
import { mergeAddManifest } from "../../add/manifest";
import { renderBrief } from "../../brief/render";
import { targetAgents } from "../../compose/agents";
import { compose, mergeCommands, mergeEnv } from "../../compose/compose";
import { fitsStack } from "../../compose/selection";
import type { Composition } from "../../compose/types";
import { buildManifest } from "../../project/manifest";
import { type Entry, isFragment, isStack } from "../../registry/entry";
import { duplicateRuns } from "../checks/verify-notes";
import type { Check, View } from "../types";
import { entryFile, finding } from "../view";
import { canonicalContext, composedLimit } from "./budget";
import { uniqueFindings } from "./composed";
import { describe, replacementDefaults } from "./compositions";

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
