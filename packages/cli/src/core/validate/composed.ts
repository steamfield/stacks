/**
 * Renders the files of every composition `stacks validate` checks, once per coding-agent adapter,
 * so the checks that read shipped files see exactly what a project would receive.
 *
 * Entries (stacks and fragments) ship files, and some ship only for one coding agent (a Claude
 * adapter, a Codex config) or only on top of one host stack (an overlay). A defect in such a file
 * appears only when that agent or stack is part of the composition, so `composedFiles` composes
 * each plan from `compositions.ts::compositionPlans` plus every overlay, in both presets,
 * then renders it through `compose/files.ts::composeFiles` with `NEUTRAL_VARS` (fixed template
 * values) separately for each adapter the composition's entries ship for. A `validate --brief`
 * preview renders only its one composition.
 *
 * The result is a `RenderState`: the rendered snapshots, compose and template findings, and the
 * conflicts already reported (`compose-each.ts` skips those). `index.ts` and `preview.ts` cache it
 * as `View.composed`; `shipped-refs.ts`, `imports.ts` and `commands.ts` read the snapshots and use
 * `sourceOf` to point a finding at the source file that produced a rendered line. Only problems in
 * a validated entry are reported, never in other origins' entries it was composed with.
 */
import { AgentId, shippedPath } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type {
  BadInput,
  ComposeConflict,
  EntryInvalid,
  NotFound,
  PermissionDenied,
} from "../../errors";
import type { Finding } from "../../schemas/validate";
import { targetAgents } from "../compose/agents";
import { compose } from "../compose/compose";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "../compose/files";
import type { ComposeOptions, Composition } from "../compose/types";
import { type Entry, isFragment, isStack, shippedOnlyFor, shipsFor } from "../registry/entry";
import { Registry } from "../registry/registry";
import { compositionPlans, describe, replacementDefaults } from "./compositions";
import type { Source } from "./sources";
import type { Check, Composed, RenderState, SourceView, View } from "./types";
import { entryFile, finding } from "./view";

/** A compose failure only the per-adapter render reports. */
type ComposeFailure = ComposeConflict | EntryInvalid;
type CompositionRun = {
  stack: Entry;
  preset: ComposeOptions["preset"];
  plan: Pick<ComposeOptions, "with" | "without">;
};
type AdapterRun = {
  stack: Entry;
  entries: ReadonlyArray<Entry>;
  options: ComposeOptions;
};

/** The preview selection or registry matrix, rendered independently for every shipped adapter. */
export const composedFiles = (view: SourceView): View["composed"] =>
  Effect.gen(function* () {
    const state: RenderState = { snapshots: [], findings: [], failures: new Set() };
    for (const run of compositionRuns(view)) yield* renderRun(view, run, state);
    return { ...state, findings: uniqueFindings(state.findings) };
  });

/** A preview renders its one selection; registry validation renders every plan. */
function compositionRuns(view: SourceView): CompositionRun[] {
  if (view.composition) {
    const { stack, preset, options } = view.composition;
    return [{ stack, preset, plan: options }];
  }
  return composedStacks(view).flatMap((stack) =>
    (["default", "sandbox"] as const).flatMap((preset) =>
      [...compositionPlans(view, stack), ...overlayPlans(view, stack)].map((plan) => ({
        stack,
        preset,
        plan,
      })),
    ),
  );
}

/**
 * The stacks whose compositions can involve a validated entry. `renderRun` keeps only those, so
 * without a validated fragment only the validated stacks qualify, and composing every other
 * origin's stacks would cost time that grows with the bundled registry for nothing.
 */
function composedStacks(view: SourceView) {
  return view.entries.some(isFragment) ? view.all.filter(isStack) : view.entries.filter(isStack);
}

/** An overlay must be checked even when its host recipe never lists the fragment. */
function overlayPlans(view: SourceView, stack: Entry) {
  if (!isStack(stack)) return [];
  return view.all
    .filter((entry): entry is Entry => "meta" in entry)
    .filter(isFragment)
    .filter((entry) => shipsOnlyFor(view, entry, { kind: "stack", id: stack.id }))
    .map((entry) => ({ with: [entry.id], without: replacementDefaults(view, stack, entry.id) }));
}

/** Whether the entry ships a file only for this agent or this host stack. */
function shipsOnlyFor(
  view: SourceView,
  entry: Entry,
  target: { kind: "agent" | "stack"; id: string },
): boolean | undefined {
  return view.sources
    .get(entry.dir)
    ?.files.some((file) => shippedOnlyFor(file.source, target.kind, target.id));
}

/** Whether the entry is one `validate` was asked about, as opposed to one it was composed with. */
function isValidated(view: Pick<View, "entries">, entry: Entry): boolean {
  return view.entries.some((wanted) => wanted.dir === entry.dir);
}

/** Whether a source file reaches a project composed for these agents on this stack. */
function selectedSource(source: string, agents: ReadonlyArray<string>, stack: string): boolean {
  return shippedPath(source) !== undefined && shipsFor(source, agents, stack);
}

/**
 * Compose one plan with the default agents to learn its entries, then render it once per agent
 * the entries ship agent-only files for (or once with the defaults when none do). A plan that
 * fails here is `compositions.ts`'s to report.
 */
const renderRun = (view: SourceView, { stack, preset, plan }: CompositionRun, state: RenderState) =>
  Effect.gen(function* () {
    const options = {
      stack: stack.id,
      with: plan.with,
      without: plan.without,
      preset,
      always: [],
      mode: "new",
    } as const;
    const base = yield* Effect.result(compose({ ...options, agents: targetAgents(undefined, {}) }));
    if (Result.isFailure(base)) return;
    const entries = [base.success.stack, ...base.success.fragments];
    if (!entries.some((entry) => isValidated(view, entry))) return;
    for (const targets of adapterTargets(view, entries))
      yield* renderAdapter(
        view,
        { stack, entries, options: { ...options, agents: targets } },
        state,
      );
  });

/** One agent list per render: each agent with agent-only files alone, or the defaults. */
function adapterTargets(view: SourceView, entries: ReadonlyArray<Entry>) {
  const agents = AgentId.literals.filter((agent) =>
    entries.some((entry) => shipsOnlyFor(view, entry, { kind: "agent", id: agent })),
  );
  return agents.length ? agents.map((agent) => [agent]) : [targetAgents(undefined, {})];
}

/** Compose and render for one adapter, keeping the snapshot or recording why it failed. */
const renderAdapter = (view: SourceView, run: AdapterRun, state: RenderState) =>
  Effect.gen(function* () {
    const composed = yield* Effect.result(compose(run.options));
    if (Result.isFailure(composed)) {
      const error = composed.failure;
      if (isAdapterFailure(error)) recordComposeFailure(view, run, error, state);
      return;
    }
    const composition = composed.success;
    const registry = yield* Registry;
    const files = yield* Effect.result(composeFiles(composition, NEUTRAL_VARS, registry));
    if (Result.isSuccess(files)) {
      state.snapshots.push({ composition, files: files.success });
      return;
    }
    const failure = files.failure;
    if (failure._tag === "EntryInvalid" && failure.details?.reason === "template")
      recordTemplateFailure(view, { run, composition, details: failure.details }, state);
  });

/**
 * Failures that depend on the adapter, so only this render can see them: conflicts between
 * adapter files and merge templates that don't fit. Other failures belong to other checks.
 */
function isAdapterFailure(
  error: ComposeFailure | NotFound | BadInput | PermissionDenied,
): error is ComposeFailure {
  return (
    error._tag === "ComposeConflict" ||
    (error._tag === "EntryInvalid" && error.details?.reason === "merge_template")
  );
}

/**
 * Report an adapter compose failure on the validated entry whose file caused it, or on the stack
 * when no validated file matches. Conflicts are remembered so `compose-each.ts` skips them.
 */
function recordComposeFailure(
  view: SourceView,
  run: AdapterRun,
  error: ComposeFailure,
  state: RenderState,
) {
  const {
    stack,
    options: { agents: targets },
  } = run;
  const source = failingSources(view, run, error).find(({ entry }) => isValidated(view, entry));
  const owner = source?.entry ?? stack;
  if (!isValidated(view, owner)) return;
  const description = describe(error);
  state.findings.push(
    finding(owner, {
      ...description,
      severity: "error",
      file: source ? view.file(owner, source.source.source) : entryFile(view, owner),
      message: `${stack.id} (${targets.join(", ")}): ${description.message}`,
    }),
  );
  if (error._tag === "ComposeConflict")
    state.failures.add(JSON.stringify([stack.id, error.details]));
}

/**
 * The composed entries' source files the failure names: by source path for an invalid entry, by
 * project path (without `.tmpl`) for a conflict, among files this adapter and stack receive.
 */
function failingSources(view: SourceView, run: AdapterRun, error: ComposeFailure) {
  const named = (source: Source) =>
    error._tag === "EntryInvalid"
      ? source.source === error.details?.path
      : source.path.replace(/\.tmpl$/, "") === error.details?.path;
  return run.entries.flatMap((entry) =>
    (view.sources.get(entry.dir)?.files ?? [])
      .filter(
        (source) =>
          named(source) && selectedSource(source.source, run.options.agents, run.stack.id),
      )
      .map((source) => ({ entry, source })),
  );
}

/** Report an unknown template variable on the validated entry that ships the file. */
function recordTemplateFailure(
  view: SourceView,
  {
    run,
    composition,
    details,
  }: { run: AdapterRun; composition: Composition; details: NonNullable<EntryInvalid["details"]> },
  state: RenderState,
) {
  const { stack, entries } = run;
  const planned = composition.files.find(
    (file) => file.source?.file === details.path && file.source?.entry.id === details.id,
  );
  const entry = entries.find(
    (entry) =>
      entry.kind === planned?.source?.entry.kind &&
      entry.id === planned.source.entry.id &&
      entry.origin === details.origin,
  );
  if (!entry || !isValidated(view, entry)) return;
  state.findings.push(
    finding(entry, {
      check: "compose",
      severity: "error",
      file: view.file(entry, details.path),
      ...(details.line === undefined ? {} : { line: details.line }),
      message: `${stack.id}: unknown template variable in ${details.path ?? "a shipped file"}`,
    }),
  );
}

type SourceQuery = {
  needle?: string;
  matches?: (source: Source) => boolean;
};

/**
 * Locate a rendered defect in its contributing source, including merged-file contributors.
 *
 * A source matches when `matches` accepts it or, without one, when it contains `needle`. A
 * validated entry's matching source wins, then any matching one, then the planned file's own
 * source, then any contributor. `line` is where the needle sits in the chosen source.
 */
export function sourceOf(
  view: View,
  snapshot: Composed,
  file: RenderedFile,
  { needle = "", matches }: SourceQuery = {},
) {
  const planned = snapshot.composition.files.find((planned) => planned.path === file.path);
  const contributors = contributingSources(view, snapshot, file);
  const matching = contributors.filter(({ source }) =>
    matches ? matches(source) : needleIndex(source, needle) >= 0,
  );
  const found =
    matching.find(({ entry }) => isValidated(view, entry)) ??
    matching[0] ??
    contributors.find(({ source }) => source.source === planned?.source?.file) ??
    contributors[0];
  if (!found) return undefined;
  const index = needleIndex(found.source, needle);
  return {
    ...found,
    line: index < 0 ? undefined : found.source.text.slice(0, index).split("\n").length,
  };
}

/** Every source that rendered into the file: one per owner, merged JSON having several. */
function contributingSources(view: View, snapshot: Composed, file: RenderedFile) {
  const { composition } = snapshot;
  const owners = file.owner.split("+");
  return [composition.stack, ...composition.fragments].flatMap((entry) => {
    if (!owners.includes(`${entry.kind}:${entry.id}`)) return [];
    return (view.sources.get(entry.dir)?.files ?? [])
      .filter(
        (source) =>
          source.path.replace(/\.tmpl$/, "") === file.path &&
          selectedSource(source.source, composition.agents, composition.stack.id),
      )
      .map((source) => ({ entry, source }));
  });
}

/** Where the needle sits in the source, as written or JSON-escaped; -1 when absent or empty. */
function needleIndex(source: Source, needle: string): number {
  if (!needle) return -1;
  const literal = source.text.indexOf(needle);
  return literal >= 0 ? literal : source.text.indexOf(JSON.stringify(needle).slice(1, -1));
}

/** A defect is reported once even if several presets, adapters or compositions expose it. */
export function uniqueFindings(values: ReadonlyArray<Finding>): Finding[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

/** Report the findings `composedFiles` gathered while rendering. */
export const renderedFileChecks: Check = (view) =>
  Effect.map(view.composed, ({ findings }) => ({ findings }));
