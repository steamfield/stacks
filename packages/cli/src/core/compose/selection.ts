/**
 * Decides which fragments go into a composition and in what order.
 *
 * A stack is a recipe for a whole project; a fragment is a reusable addition (CI, git hooks, a
 * database) that composes onto it. When someone runs `stacks new <stack>` or `stacks add
 * <fragment>`, `compose.ts::compose` calls `selectFragments` first, and everything else in a
 * composition (files, verify steps, env, the brief) follows from the list it returns.
 *
 * Fragments come in from five places, applied in this order: the stack's `required` list, its
 * `default` list, the user's `Settings.always`, `--with`, and finally anything those fragments
 * pull in through their own `requires`. Each fragment remembers how it got in (its `Via`), because
 * that decides which rules apply to it: `--sandbox` drops deploy, release and app fragments only
 * from the defaults and `always`; `--without` may remove a default but never a requirement; a
 * fragment the user asked for with `--with` is kept even when its `appliesTo` doesn't name the
 * stack. After selection come the whole-set checks (at most one app, no declared `conflicts`, fit),
 * then `order` sorts requirements first, ties by id, the app last.
 *
 * In `add` mode, fragments the project already has (`existing`) satisfy requirements and still
 * take part in the conflict checks, but they are not selected again. Every failure here is a
 * `ComposeConflict`, `BadInput` or `NotFound` the user can act on; nothing is written. Start at
 * `selectFragments`.
 */
import type { Category, FragmentMeta, Kind, StackMeta } from "@steamfield/stacks-format";
import { Effect } from "effect";
import {
  BadInput,
  type ComposeConflict,
  type EntryInvalid,
  NotFound,
  type PermissionDenied,
} from "../../errors";
import { type CatalogEntry, type Entry, isFragment, isRejected, isStack } from "../registry/entry";
import type { Registry } from "../registry/registry";
import { closest } from "../suggest";
import { conflict } from "./conflicts";
import type { ComposeOptions, ComposeWarning, Via } from "./types";

/** Categories `--sandbox` leaves out unless named with `--with` or required by another fragment. */
const SANDBOX_DROPS: ReadonlyArray<Category> = ["deploy", "release", "app"];
type Fragment = Entry & { meta: FragmentMeta };
type Stack = Entry & { meta: StackMeta };
type SelectError = NotFound | EntryInvalid | ComposeConflict | PermissionDenied;

const isApp = (fragment: Fragment) => fragment.meta.category === "app";
const droppedBySandbox = (fragment: Fragment, sandbox: boolean) =>
  sandbox && SANDBOX_DROPS.includes(fragment.meta.category);
const byId = (a: string, b: string) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** Whether a fragment's `appliesTo` names the stack or one of its tags; empty fits anywhere. */
export function fitsStack(
  appliesTo: ReadonlyArray<string>,
  stack: { id: string; tags: ReadonlyArray<string> },
): boolean {
  return (
    !appliesTo.length ||
    appliesTo.includes(stack.id) ||
    stack.tags.some((tag) => appliesTo.includes(tag))
  );
}
const fits = (fragment: Fragment, stack: Stack) =>
  fitsStack(fragment.meta.appliesTo, { id: stack.id, tags: stack.meta.tags });

/** What every lookup needs: the registry, its catalog and the ids that count as fragments. */
type Lookup = {
  readonly registry: Registry["Service"];
  readonly catalog: ReadonlyArray<CatalogEntry>;
  readonly fragmentIds: ReadonlySet<string>;
};

/**
 * One `selectFragments` call's inputs and the state it fills in as it goes. `via` records how
 * each selected fragment got in, `loaded` caches every fragment read, `visits` marks the
 * requirement walk's progress for cycle detection, and `warnings` collects in the order they arise.
 */
type SelectionRun = Lookup & {
  readonly options: ComposeOptions<"new" | "add">;
  readonly stack: Stack | null;
  readonly without: ReadonlySet<string>;
  /** `--with` ids, deduplicated and sorted. */
  readonly withIds: ReadonlyArray<string>;
  readonly existing: ReadonlySet<string>;
  readonly sandbox: boolean;
  readonly loaded: Map<string, Fragment>;
  readonly via: Map<string, Via>;
  readonly visits: Map<string, "visiting" | "done">;
  readonly warnings: ComposeWarning[];
};

/** One `requires` edge being walked; a `null` requirer is the stack or the user's own choice. */
type RequirementEdge = {
  readonly id: string;
  readonly requirer: string | null;
  readonly how: Via;
  /** The fragment ids walked to reach this edge, for reporting a cycle. */
  readonly path: ReadonlyArray<string>;
};

export function selectFragments(
  registry: Registry["Service"],
  options: ComposeOptions<"new" | "add">,
) {
  return Effect.gen(function* () {
    const catalog = yield* registry.catalog;
    const stack = yield* loadStack(registry, catalog, options.stack);
    // Historical pins are valid fragment ids even when the current schema is unsupported.
    const pins = (stack?.composition ?? []).map((pinned) => pinned.id);
    const fragmentIds = new Set([...knownIds(catalog, "fragment"), ...pins]);
    const lookup: Lookup = { registry, catalog, fragmentIds };
    const { without, withIds } = yield* checkRequested(lookup, options);
    const existing = new Set(options.existing ?? []);
    yield* refuseAlreadyApplied(withIds, existing);
    const run: SelectionRun = {
      ...lookup,
      options,
      stack,
      without,
      withIds,
      existing,
      sandbox: options.preset === "sandbox",
      loaded: new Map(),
      via: new Map(),
      visits: new Map(),
      warnings: [],
    };

    yield* selectRequired(run);
    yield* selectDefaults(run);
    yield* selectAlways(run);
    yield* selectWith(run);
    warnUnusedWithout(run);
    yield* selectRequirements(run);

    const selected = [...run.via.keys()].sort(byId).flatMap((id) => run.loaded.get(id) ?? []);
    const appliedEntries = yield* loadApplied(run);
    yield* checkConflicts(run, selected, appliedEntries);
    yield* checkFit(run, selected);

    return {
      stack,
      ordered: order(selected),
      via: run.via,
      warnings: run.warnings,
      existing,
      appliedEntries,
    };
  });
}

const knownIds = (catalog: ReadonlyArray<CatalogEntry>, kind: Kind) =>
  catalog.filter((item) => item.kind === kind).map((item) => item.id);

/**
 * `NotFound` for an id the catalog doesn't list. Suggestions come only from entries that pass the
 * full load, so this reads the whole registry, which is fine on a path that already failed.
 */
const notFound = (registry: Registry["Service"], id: string, kind: Kind) =>
  Effect.gen(function* () {
    const checked = yield* registry.all;
    const usable = checked
      .filter((item) => item.kind === kind && !isRejected(item))
      .map((item) => item.id);
    return yield* new NotFound({ details: { suggestions: closest(id, usable), id, kind } });
  });

/** The stack being composed, or `null` in `add` mode when the project names no known stack. */
const loadStack = (
  registry: Registry["Service"],
  catalog: ReadonlyArray<CatalogEntry>,
  id: string | null,
) =>
  Effect.gen(function* () {
    if (id === null) return null;
    if (!knownIds(catalog, "stack").includes(id)) return yield* notFound(registry, id, "stack");
    const entry = yield* registry.get("stack", id);
    if (!isStack(entry)) return yield* Effect.die(new Error("Registry returned a non-stack"));
    return entry;
  });

/**
 * Every `--with` and `--without` id names a fragment, and no id is in both. In `add` mode a stack
 * id is reported as a bad argument rather than missing, since the user named the wrong kind.
 */
const checkRequested = (lookup: Lookup, options: ComposeOptions<"new" | "add">) =>
  Effect.gen(function* () {
    for (const id of [...options.with, ...options.without])
      yield* checkRequestedFragment(lookup, options.mode, id);
    const without = new Set(options.without);
    const withIds = [...new Set(options.with)].sort(byId);
    const both = withIds.find((id) => without.has(id));
    if (both !== undefined)
      return yield* new BadInput({ details: { id: both, flag: "with_without" } });
    return { without, withIds };
  });

const checkRequestedFragment = (lookup: Lookup, mode: "new" | "add", id: string) =>
  Effect.gen(function* () {
    if (lookup.fragmentIds.has(id)) return;
    if (mode === "add" && knownIds(lookup.catalog, "stack").includes(id))
      return yield* new BadInput({ details: { id, flag: "fragment" } });
    return yield* notFound(lookup.registry, id, "fragment");
  });

/** `add` refuses to apply a fragment the project already has. */
const refuseAlreadyApplied = (withIds: ReadonlyArray<string>, existing: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const applied = withIds.filter((id) => existing.has(id));
    if (applied.length)
      return yield* new BadInput({
        details: { id: applied[0] ?? "", flag: "fragment", alreadyApplied: applied },
      });
  });

/**
 * The fragment entry to compose for `id`. A stack may pin the exact fragment versions it was
 * proven with (`composition`); the pin wins unless the user overrode that fragment with a
 * project or user registry copy.
 */
function compositionFragment(run: SelectionRun, id: string) {
  const current = run.catalog.find((entry) => entry.kind === "fragment" && entry.id === id);
  const pinned = run.stack?.composition?.find((entry) => entry.id === id);
  if (pinned && current?.origin !== "project" && current?.origin !== "user")
    return Effect.succeed(pinned);
  return run.registry.get("fragment", id);
}

/** The parties of a requirement edge for a conflict: `null` stands for the stack. */
const edgeParties = (stack: Stack | null, requirer: string | null, id: string) =>
  requirer === null
    ? { ...(stack ? { stack: stack.id } : {}), ids: [id] }
    : { ids: [requirer, id] };

/** A fragment an entry names, read once; an id that names none is a requirement nothing satisfies. */
const loadFragment = (run: SelectionRun, id: string, requirer: string | null) =>
  Effect.gen(function* () {
    const cached = run.loaded.get(id);
    if (cached) return cached;
    if (!run.fragmentIds.has(id))
      return yield* conflict({ reason: "requires", ...edgeParties(run.stack, requirer, id) });
    const entry = yield* compositionFragment(run, id);
    if (!isFragment(entry)) return yield* Effect.die(new Error("Registry returned a non-fragment"));
    run.loaded.set(id, entry);
    return entry;
  });

/** The cycle through `id`, rotated to start at its smallest id so the report is stable. */
function cycleConflict(path: ReadonlyArray<string>, id: string) {
  const cycle = path.slice(path.indexOf(id));
  const start = cycle.indexOf([...cycle].sort(byId)[0] ?? id);
  return conflict({ reason: "cycle", ids: [...cycle.slice(start), ...cycle.slice(0, start)] });
}

/**
 * What is wrong with pulling `fragment` in as a requirement, if anything: an app can't be
 * required, and a requirement can't be removed with `--without`.
 */
function requirementProblem(run: SelectionRun, fragment: Fragment, edge: RequirementEdge) {
  const pulled = edge.how === "required" || edge.how === "requires";
  if (!pulled) return undefined;
  const parties = edgeParties(run.stack, edge.requirer, fragment.id);
  if (isApp(fragment)) return conflict({ reason: "app_required", ...parties });
  if (run.without.has(fragment.id))
    return conflict({ reason: edge.how === "required" ? "required" : "requires", ...parties });
  return undefined;
}

/**
 * Depth first over `requires`: checks each edge and finds cycles. A fragment the project already
 * has ends the walk, since it is satisfied already.
 */
const visit = (run: SelectionRun, edge: RequirementEdge): Effect.Effect<void, SelectError> =>
  Effect.gen(function* () {
    if (run.existing.has(edge.id)) return;
    const seen = run.visits.get(edge.id);
    if (seen === "visiting") return yield* cycleConflict(edge.path, edge.id);
    const fragment = yield* loadFragment(run, edge.id, edge.requirer);
    const problem = requirementProblem(run, fragment, edge);
    if (problem) return yield* problem;
    // Checked per edge above, so the outcome doesn't depend on which edge was walked first.
    if (seen === "done") return;
    yield* visitRequirements(run, fragment, edge);
  });

/**
 * Walks `fragment`'s own requirements, then records how it got in unless something already did.
 * A requirement of a `required` fragment is itself `required`; any other is `requires`.
 */
const visitRequirements = (
  run: SelectionRun,
  fragment: Fragment,
  edge: RequirementEdge,
): Effect.Effect<void, SelectError> =>
  Effect.gen(function* () {
    const { id, how, path } = edge;
    run.visits.set(id, "visiting");
    const next: Via = how === "required" ? "required" : "requires";
    for (const required of fragment.meta.requires)
      yield* visit(run, { id: required, requirer: id, how: next, path: [...path, id] });
    run.visits.set(id, "done");
    if (!run.via.has(id)) run.via.set(id, how);
  });

/** Step 1, `new` only: the stack's required fragments, with their requirements. */
const selectRequired = (run: SelectionRun) =>
  Effect.gen(function* () {
    if (run.options.mode !== "new") return;
    for (const id of run.stack?.meta.fragments.required ?? [])
      yield* visit(run, { id, requirer: null, how: "required", path: [] });
  });

/**
 * Step 2, `new` only: the stack's defaults (none under `--preset lean`), minus `--without` and
 * the sandbox drops.
 */
const selectDefaults = (run: SelectionRun) =>
  Effect.gen(function* () {
    const { options, stack } = run;
    const defaults =
      options.mode === "new" && !options.lean ? (stack?.meta.fragments.default ?? []) : [];
    for (const id of defaults) {
      if (run.without.has(id) || run.via.has(id)) continue;
      const fragment = yield* loadFragment(run, id, null);
      if (droppedBySandbox(fragment, run.sandbox)) continue;
      run.via.set(id, "default");
    }
  });

/** Step 3: the user's `always`, where it fits the stack; an unknown or unfitting id only warns. */
const selectAlways = (run: SelectionRun) =>
  Effect.gen(function* () {
    for (const id of run.options.always) yield* selectAlwaysFragment(run, id);
  });

const selectAlwaysFragment = (run: SelectionRun, id: string) =>
  Effect.gen(function* () {
    if (run.without.has(id) || run.via.has(id)) return;
    if (!run.fragmentIds.has(id)) {
      run.warnings.push({ code: "always_unknown", id });
      return;
    }
    const fragment = yield* loadFragment(run, id, null);
    if (run.stack && !fits(fragment, run.stack)) {
      run.warnings.push({ code: "always_not_applicable", id: fragment.id });
      return;
    }
    if (droppedBySandbox(fragment, run.sandbox)) return;
    run.via.set(id, "always");
  });

/**
 * Step 4: `--with`, kept even when it doesn't fit or the sandbox would drop it. In `add` mode an
 * unfitting fragment is refused, because the project already exists and can't be reshaped for it.
 */
const selectWith = (run: SelectionRun) =>
  Effect.gen(function* () {
    const { stack } = run;
    for (const id of run.withIds) {
      const fragment = yield* loadFragment(run, id, null);
      if (run.options.mode === "add" && stack && !fits(fragment, stack))
        return yield* conflict({ reason: "applies_to", ids: [id] });
      if (stack && !fits(fragment, stack)) run.warnings.push({ code: "with_not_applicable", id });
      if (run.via.get(id) !== "required") run.via.set(id, "with");
    }
  });

/** A `--without` id that neither the stack's defaults nor `always` would have selected. */
function warnUnusedWithout(run: SelectionRun) {
  const defaults = run.stack?.meta.fragments.default ?? [];
  for (const id of [...run.without].sort(byId))
    if (!defaults.includes(id) && !run.options.always.includes(id))
      run.warnings.push({ code: "without_not_selected", id });
}

/** Step 5: the requirements of everything selected so far, walked in id order. */
const selectRequirements = (run: SelectionRun) =>
  Effect.gen(function* () {
    for (const id of [...run.via.keys()].sort(byId))
      yield* visit(run, { id, requirer: null, how: run.via.get(id) ?? "requires", path: [] });
  });

/** The fragments an `add` project already has, for the conflict checks; unknown ids are skipped. */
const loadApplied = (run: SelectionRun) =>
  Effect.gen(function* () {
    const appliedEntries: Fragment[] = [];
    for (const id of run.existing) {
      if (!run.fragmentIds.has(id)) continue;
      appliedEntries.push(yield* loadFragment(run, id, null));
    }
    return appliedEntries;
  });

/** At most one app, and no fragment present alongside one it declares in `conflicts`. */
const checkConflicts = (
  run: SelectionRun,
  selected: ReadonlyArray<Fragment>,
  appliedEntries: ReadonlyArray<Fragment>,
) =>
  Effect.gen(function* () {
    // Existing fragments still participate in composition constraints.
    const all = [...selected, ...appliedEntries];
    const present = new Set([...run.existing, ...selected.map((fragment) => fragment.id)]);
    const apps = all
      .filter(isApp)
      .map((fragment) => fragment.id)
      .sort(byId);
    if (apps.length > 1) return yield* conflict({ reason: "app_count", ids: apps });
    for (const fragment of all)
      for (const other of fragment.meta.conflicts)
        if (present.has(other))
          return yield* conflict({ reason: "conflicts", ids: [fragment.id, other].sort(byId) });
  });

/**
 * Fit, for what the stack author or a requirement chose: such a fragment must fit the stack.
 * Without a stack, a fragment that limits where it applies only warns.
 */
const checkFit = (run: SelectionRun, selected: ReadonlyArray<Fragment>) =>
  Effect.gen(function* () {
    const { stack } = run;
    for (const fragment of selected) {
      if (!stack && fragment.meta.appliesTo.length)
        run.warnings.push({ code: "with_not_applicable", id: fragment.id });
      const how = run.via.get(fragment.id);
      if (how !== "with" && how !== "always" && stack && !fits(fragment, stack))
        return yield* conflict({ reason: "applies_to", ids: [fragment.id] });
    }
  });

/** Topological by `requires` (a requirement first), ties by id, the app last. */
function order(selected: ReadonlyArray<Fragment>): Fragment[] {
  const ids = new Set(selected.map((fragment) => fragment.id));
  const done = new Set<string>();
  const out: Fragment[] = [];
  const waiting = [...selected];
  while (waiting.length) {
    // Cycles were refused while selecting, so something is always ready.
    const ready = waiting
      .filter((fragment) => fragment.meta.requires.every((id) => !ids.has(id) || done.has(id)))
      .sort((a, b) => Number(isApp(a)) - Number(isApp(b)) || byId(a.id, b.id))[0];
    if (!ready) break;
    waiting.splice(waiting.indexOf(ready), 1);
    done.add(ready.id);
    out.push(ready);
  }
  return out;
}
