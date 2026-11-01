import { AgentId } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { ComposeConflict, EntryInvalid } from "../../errors";
import type { Finding } from "../../schemas/validate";
import { targetAgents } from "../compose/agents";
import { type ComposeOptions, type Composition, compose } from "../compose/compose";
import { composeFiles, NEUTRAL_VARS, type RenderedFile } from "../compose/files";
import {
  type Entry,
  isFragment,
  isStack,
  shippedOnlyFor,
  shippedPath,
  shipsFor,
} from "../registry/entry";
import { Registry } from "../registry/registry";
import { compositionPlans, describe, replacementDefaults } from "./compositions";
import type { Source } from "./sources";
import { type Check, entryFile, finding, type View } from "./view";

export type Composed = { composition: Composition; files: ReadonlyArray<RenderedFile> };

type SourceView = Omit<View, "composed">;
type CompositionRun = {
  stack: Entry;
  preset: ComposeOptions["preset"];
  plan: Pick<ComposeOptions, "with" | "without">;
};
type RenderState = {
  snapshots: Composed[];
  findings: Finding[];
  failures: Set<string>;
};
type AdapterRun = {
  stack: Entry;
  entries: ReadonlyArray<Entry>;
  options: ComposeOptions;
};

/** The preview selection or registry matrix, rendered independently for every shipped adapter. */
export const composedFiles = (view: SourceView) =>
  Effect.gen(function* () {
    const state: RenderState = { snapshots: [], findings: [], failures: new Set() };
    for (const run of compositionRuns(view)) yield* renderRun(view, run, state);
    return { ...state, findings: uniqueFindings(state.findings) };
  });

function compositionRuns(view: SourceView): CompositionRun[] {
  // A preview renders its one selection; registry validation renders every budgeted one.
  return view.composition
    ? [
        {
          stack: view.composition.stack,
          preset: view.composition.preset,
          plan: view.composition.options,
        },
      ]
    : view.all.filter(isStack).flatMap((stack) =>
        (["default", "sandbox"] as const).flatMap((preset) =>
          [...compositionPlans(view, stack), ...overlayPlans(view, stack)].map((plan) => ({
            stack,
            preset,
            plan,
          })),
        ),
      );
}

/** An overlay must be checked even when its host recipe never lists the fragment. */
function overlayPlans(view: SourceView, stack: Entry) {
  if (!isStack(stack)) return [];
  return view.all
    .filter((entry): entry is Entry => "meta" in entry)
    .filter(isFragment)
    .filter((entry) =>
      view.sources
        .get(entry.dir)
        ?.files.some((file) => shippedOnlyFor(file.source, "stack", stack.id)),
    )
    .map((entry) => ({ with: [entry.id], without: replacementDefaults(view, stack, entry.id) }));
}

function selectedSource(source: string, agents: ReadonlyArray<string>, stack: string): boolean {
  return shippedPath(source) !== undefined && shipsFor(source, agents, stack);
}

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
    if (!entries.some((entry) => view.entries.some((wanted) => wanted.dir === entry.dir))) return;
    const agents = AgentId.literals.filter((agent) =>
      entries.some((entry) =>
        view.sources
          .get(entry.dir)
          ?.files.some((file) => shippedOnlyFor(file.source, "agent", agent)),
      ),
    );

    for (const targets of agents.length
      ? agents.map((agent) => [agent])
      : [targetAgents(undefined, {})]) {
      yield* renderAdapter(
        view,
        { stack, entries, options: { ...options, agents: targets } },
        state,
      );
    }
  });

const renderAdapter = (view: SourceView, run: AdapterRun, state: RenderState) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(compose(run.options));
    if (Result.isFailure(result)) {
      const error = result.failure;
      if (
        error._tag === "ComposeConflict" ||
        (error._tag === "EntryInvalid" && error.details?.reason === "merge_template")
      )
        recordComposeFailure(view, run, error, state);
      return;
    }
    const registry = yield* Registry;
    const files = yield* Effect.result(composeFiles(result.success, NEUTRAL_VARS, registry));
    if (Result.isSuccess(files)) {
      state.snapshots.push({ composition: result.success, files: files.success });
    } else if (
      files.failure._tag === "EntryInvalid" &&
      files.failure.details?.reason === "template"
    ) {
      recordTemplateFailure(
        view,
        { run, composition: result.success, details: files.failure.details },
        state,
      );
    }
  });

function recordComposeFailure(
  view: SourceView,
  run: AdapterRun,
  error: ComposeConflict | EntryInvalid,
  state: RenderState,
) {
  const {
    stack,
    entries,
    options: { agents: targets },
  } = run;
  const candidates = entries.flatMap((entry) =>
    (view.sources.get(entry.dir)?.files ?? [])
      .filter(
        (source) =>
          (error._tag === "EntryInvalid"
            ? source.source === error.details?.path
            : source.path.replace(/\.tmpl$/, "") === error.details?.path) &&
          selectedSource(source.source, targets, stack.id),
      )
      .map((source) => ({ entry, source })),
  );
  const source = candidates.find(({ entry }) =>
    view.entries.some((wanted) => wanted.dir === entry.dir),
  );
  const owner = source?.entry ?? stack;
  if (!view.entries.some((wanted) => wanted.dir === owner.dir)) return;
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
  if (entry && view.entries.some((wanted) => wanted.dir === entry.dir))
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

/** Locate a rendered defect in its contributing source, including merged-file contributors. */
export function sourceOf(
  view: View,
  snapshot: Composed,
  file: RenderedFile,
  { needle = "", matches }: SourceQuery = {},
) {
  const planned = snapshot.composition.files.find((planned) => planned.path === file.path);
  const entries = [snapshot.composition.stack, ...snapshot.composition.fragments];
  const contributors = entries.flatMap((entry) => {
    if (!file.owner.split("+").includes(`${entry.kind}:${entry.id}`)) return [];
    return (view.sources.get(entry.dir)?.files ?? [])
      .filter(
        (source) =>
          source.path.replace(/\.tmpl$/, "") === file.path &&
          selectedSource(source.source, snapshot.composition.agents, snapshot.composition.stack.id),
      )
      .map((source) => ({ entry, source }));
  });
  const indexOf = (source: Source) => {
    if (!needle) return -1;
    const literal = source.text.indexOf(needle);
    return literal >= 0 ? literal : source.text.indexOf(JSON.stringify(needle).slice(1, -1));
  };
  const matching = contributors.filter(({ source }) =>
    matches ? matches(source) : indexOf(source) >= 0,
  );
  const found =
    matching.find(({ entry }) => view.entries.some((wanted) => wanted.dir === entry.dir)) ??
    matching[0] ??
    contributors.find(({ source }) => source.source === planned?.source?.file) ??
    contributors[0];
  if (!found) return undefined;
  const index = indexOf(found.source);
  return {
    ...found,
    line: index < 0 ? undefined : found.source.text.slice(0, index).split("\n").length,
  };
}

/** A defect is reported once even if several presets, adapters or compositions expose it. */
export function uniqueFindings(values: ReadonlyArray<Finding>): Finding[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

export const renderedFileChecks: Check = (view) =>
  Effect.map(view.composed, ({ findings }) => ({ findings }));
