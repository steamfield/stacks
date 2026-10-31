import { Effect, Result } from "effect";
import type { Finding } from "../../schemas/validate";
import { mergeAddManifest } from "../add/manifest";
import { renderBrief } from "../brief/render";
import { targetAgents } from "../compose/agents";
import { compose } from "../compose/compose";
import { fitsStack } from "../compose/selection";
import { buildManifest } from "../manifest";
import { type Entry, isFragment, isStack } from "../registry/entry";
import { canonicalContext, composedLimit } from "./budget";
import { uniqueFindings } from "./composed";
import { describe, replacementDefaults } from "./compositions";
import { duplicateRuns } from "./verify-notes";
import { type Check, entryFile, finding, type View } from "./view";

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

const checkAddComposition = Effect.fn("validate.addComposition")(function* (
  view: View,
  fragment: Entry,
  stack: Entry | null,
  preset: "default" | "sandbox",
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
  const subject = `${fragment.id} ${stack ? `with ${stack.id}` : "without a stack"} (${preset}, add)`;
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
  const addedSteps = new Set(incoming.verify.map((step) => step.name));
  const findings = duplicateRuns(manifest.verify)
    .filter((names) => names.some((name) => addedSteps.has(name)))
    .map((names) =>
      finding(fragment, {
        check: "verify-run-duplicate",
        severity: "note",
        file: entryFile(view, fragment),
        message: `${fragment.id} ${stack ? `with ${stack.id}` : "without a stack"} (add): steps ${names.join(", ")} run the same command in one composed manifest; keep both only if the repetition is intentional.`,
      }),
    );
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
  const limit = composedLimit(composition);
  if (brief.briefWords > limit)
    findings.push(
      finding(fragment, {
        check: "budget-add",
        severity: "error",
        file: entryFile(view, fragment),
        message: `${subject}: add brief exceeds ${limit.toLocaleString("en-US")} words`,
      }),
    );
  return findings;
});

/** Start from the recipe's default host, leaving the tested addition out of its applied set. */
const canonicalHost = Effect.fn("validate.addHost")(function* (
  view: View,
  {
    fragment,
    stack,
    preset,
    agents,
  }: {
    fragment: Entry;
    stack: Entry | null;
    preset: "default" | "sandbox";
    agents: ReturnType<typeof targetAgents>;
  },
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
  // Ordinary composition checks own a broken base recipe.
  if (Result.isFailure(result)) return undefined;
  const base = result.success;
  const fragments = base.fragments.filter((entry) => entry.id !== fragment.id);
  const entries = [base.stack, ...fragments];
  return yield* buildManifest(
    {
      ...base,
      fragments,
      verify: base.verify.filter(
        (step) => step.owner.kind !== "fragment" || step.owner.id !== fragment.id,
      ),
      commands: Object.fromEntries(entries.flatMap((entry) => Object.entries(entry.meta.commands))),
      env: Object.fromEntries(entries.flatMap((entry) => Object.entries(entry.meta.env))),
    },
    { briefWords: 0 },
  );
});
