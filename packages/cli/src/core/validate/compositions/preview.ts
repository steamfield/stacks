/**
 * Lets authors inspect a composition's brief, fingerprint and findings before writing a project.
 * It uses `canonicalContext` so budget counts agree with validation. Golden tests pin the brief
 * and fingerprint bytes.
 */
import { Effect, Path } from "effect";
import { AppConfig } from "../../../config";
import { BadInput, NotFound } from "../../../errors";
import type { BriefPreview, Finding } from "../../../schemas/validate";
import { targetAgents } from "../../compose/agents";
import { compose } from "../../compose/compose";
import type { ComposeOptions, Composition } from "../../compose/types";
import { fingerprint } from "../../fingerprint";
import { type Entry, isRejected, type RejectedEntry } from "../../registry/entry";
import { Registry } from "../../registry/registry";
import { loadChecks } from "../checks/format";
import { gitChecks } from "../checks/git";
import { checks, compareFindings, validationRoots } from "../index";
import { readSources } from "../sources";
import type { Target } from "../target";
import type { View } from "../types";
import { rootPaths } from "../view";
import { addCompositionChecks } from "./add-compositions";
import { canonicalBrief, composedLimit } from "./budget";
import { composeEachChecks } from "./compose-each";
import { composedFiles } from "./composed";

type PreviewOptions = {
  stack: string;
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
  preset: "default" | "sandbox";
};

/**
 * Preview shares `validationRoots` with registry validation. A compose failure fails the
 * command because there is no brief to show.
 */
export const previewBrief = (target: Target, options: PreviewOptions) =>
  Effect.gen(function* () {
    const roots = yield* validationRoots(target);
    const settings = yield* (yield* AppConfig).get;
    const composeOptions: ComposeOptions = {
      ...options,
      agents: targetAgents(undefined, settings).slice(0, 1),
      always: [],
      mode: "new",
    };
    return yield* previewInRegistry(target, composeOptions).pipe(
      Effect.provide(Registry.layer(roots)),
    );
  });

const previewInRegistry = (target: Target, options: ComposeOptions) =>
  Effect.gen(function* () {
    const all = yield* (yield* Registry).all;
    if (namesOnlyAFragment(all, options.stack))
      return yield* new BadInput({ details: { id: options.stack, flag: "brief_stack" } });
    const composition = yield* composePreview(target, options);
    const view = yield* previewView(target, { all, composition, options });
    const findings = yield* previewFindings(view);
    return yield* previewResult(composition, findings);
  });

/** `--brief` takes a stack; an id that only a fragment has is a usage mistake, not "not found". */
function namesOnlyAFragment(all: ReadonlyArray<Entry | RejectedEntry>, id: string): boolean {
  return (
    !all.some((entry) => entry.kind === "stack" && entry.id === id) &&
    all.some((entry) => entry.kind === "fragment" && entry.id === id)
  );
}

/** Compose the selection; a not-found names the validated root, since `list` doesn't read it. */
const composePreview = (target: Target, options: ComposeOptions) =>
  compose(options).pipe(
    Effect.mapError((error) =>
      error._tag === "NotFound" && error.details && !target.bundled
        ? new NotFound({ details: { ...error.details, root: target.root } })
        : error,
    ),
  );

/**
 * A check view over just the composed entries, carrying the composition so the composition and
 * rendered-file checks use it instead of building the registry's plans.
 */
const previewView = (
  target: Target,
  {
    all,
    composition,
    options,
  }: {
    all: ReadonlyArray<Entry | RejectedEntry>;
    composition: Composition;
    options: ComposeOptions;
  },
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const selected = [composition.stack, ...composition.fragments];
    const wanted = (item: { kind: string; id: string }) =>
      selected.some((entry) => entry.kind === item.kind && entry.id === item.id);
    // Keep original bodies, including every conditional branch, for the entry checks.
    const entries = all.filter((entry): entry is Entry => !isRejected(entry) && wanted(entry));
    const sourceView: Omit<View, "composed"> = {
      root: target.root,
      bundled: target.bundled,
      entries,
      rejected: [],
      all,
      sources: yield* readSources(entries),
      wanted,
      ...rootPaths(path, target.root),
      composition: { ...composition, options },
    };
    const view: View = {
      ...sourceView,
      composed: yield* Effect.cached(composedFiles(sourceView)),
    };
    return view;
  });

/**
 * The registry checks that apply to one composition. Loading already succeeded. Git checks
 * depend on the checkout and start a process; compose-each and add-mode checks cover fragment
 * compatibility across stacks. All of those are registry properties, outside this canonical,
 * process-free preview of one composition.
 */
function previewChecks() {
  return checks.filter(
    (check) =>
      check !== loadChecks &&
      check !== gitChecks &&
      check !== composeEachChecks &&
      check !== addCompositionChecks,
  );
}

const previewFindings = (view: View) =>
  Effect.map(
    Effect.forEach(previewChecks(), (check) => check(view)),
    (results) => results.flatMap((result) => result.findings).sort(compareFindings),
  );

const previewResult = (composition: Composition, findings: Finding[]) =>
  Effect.gen(function* () {
    const brief = canonicalBrief(composition);
    return {
      stack: composition.stack.id,
      preset: composition.preset,
      fragments: composition.fragments.map((fragment) => fragment.id),
      app: composition.app?.id ?? null,
      briefWords: brief.briefWords,
      fixedWords: brief.fixedWords,
      limit: composedLimit(composition),
      warnings: composition.warnings.map(({ code, id }) => ({ code, id })),
      brief: brief.text,
      fingerprint: yield* fingerprint(composition),
      findings,
    } satisfies BriefPreview;
  });
