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
import type { ComposeOptions, ComposeWarning, Via } from "./compose";
import { conflict } from "./conflicts";

/** Categories `--sandbox` leaves out unless named with `--with` or required by another fragment. */
const SANDBOX_DROPS: ReadonlyArray<Category> = ["deploy", "release", "app"];
type Fragment = Entry & { meta: FragmentMeta };
type Stack = Entry & { meta: StackMeta };

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

function compositionFragment(
  registry: Registry["Service"],
  options: {
    stack: Stack | null;
    catalog: ReadonlyArray<CatalogEntry>;
    id: string;
  },
) {
  const { stack, catalog, id } = options;
  const current = catalog.find((entry) => entry.kind === "fragment" && entry.id === id);
  const pinned = stack?.composition?.find((entry) => entry.id === id);
  if (pinned && current?.origin !== "project" && current?.origin !== "user")
    return Effect.succeed(pinned);
  return registry.get("fragment", id);
}

export function selectFragments(
  registry: Registry["Service"],
  options: ComposeOptions<"new" | "add">,
) {
  return Effect.gen(function* () {
    const listed = yield* registry.catalog;
    const known = (kind: Kind) =>
      listed.filter((item) => item.kind === kind).map((item) => item.id);
    const fragmentIds = new Set(known("fragment"));
    const missing = (id: string, kind: Kind) =>
      Effect.gen(function* () {
        const checked = yield* registry.all;
        const usable = checked
          .filter((item) => item.kind === kind && !isRejected(item))
          .map((item) => item.id);
        return yield* new NotFound({ details: { suggestions: closest(id, usable), id, kind } });
      });

    const loadStack = Effect.gen(function* () {
      if (options.stack === null) return null;
      if (!known("stack").includes(options.stack)) return yield* missing(options.stack, "stack");
      const entry = yield* registry.get("stack", options.stack);
      if (!isStack(entry)) return yield* Effect.die(new Error("Registry returned a non-stack"));
      return entry;
    });
    const stack = yield* loadStack;
    for (const pinned of stack?.composition ?? []) fragmentIds.add(pinned.id);

    const checkRequestedFragment = (id: string) =>
      Effect.gen(function* () {
        if (!fragmentIds.has(id)) {
          if (options.mode === "add" && known("stack").includes(id))
            return yield* new BadInput({ details: { id, flag: "fragment" } });
          return yield* missing(id, "fragment");
        }
      });
    const validateRequested = Effect.gen(function* () {
      // Historical pins are valid fragment ids even when the current schema is unsupported.
      for (const id of [...options.with, ...options.without]) yield* checkRequestedFragment(id);
      const without = new Set(options.without);
      const withIds = [...new Set(options.with)].sort(byId);
      const both = withIds.find((id) => without.has(id));
      if (both !== undefined)
        return yield* new BadInput({ details: { id: both, flag: "with_without" } });

      return { without, withIds };
    });
    const { without, withIds } = yield* validateRequested;

    const existing = new Set(options.existing ?? []);
    const applied = withIds.filter((id) => existing.has(id));
    if (applied.length)
      return yield* new BadInput({
        details: { id: applied[0] ?? "", flag: "fragment", alreadyApplied: applied },
      });
    const sandbox = options.preset === "sandbox";
    /** A requirer and what it requires; `null` is the stack. */
    const edge = (requirer: string | null, id: string) =>
      requirer === null
        ? { ...(stack ? { stack: stack.id } : {}), ids: [id] }
        : { ids: [requirer, id] };

    const loaded = new Map<string, Fragment>();
    /** A fragment an entry names; an id that names none is a requirement nothing can satisfy. */
    const load = (id: string, requirer: string | null) =>
      Effect.gen(function* () {
        const cached = loaded.get(id);
        if (cached) return cached;
        if (!fragmentIds.has(id))
          return yield* conflict({ reason: "requires", ...edge(requirer, id) });
        const entry = yield* compositionFragment(registry, { stack, catalog: listed, id });
        if (!isFragment(entry))
          return yield* Effect.die(new Error("Registry returned a non-fragment"));
        loaded.set(id, entry);
        return entry;
      });

    const cycleConflict = (path: ReadonlyArray<string>, id: string) => {
      const cycle = path.slice(path.indexOf(id));
      const start = cycle.indexOf([...cycle].sort(byId)[0] ?? id);
      return conflict({ reason: "cycle", ids: [...cycle.slice(start), ...cycle.slice(0, start)] });
    };
    const checkRequirement = (fragment: Fragment, requirer: string | null, how: Via) => {
      const pulled = how === "required" || how === "requires";
      if (pulled && isApp(fragment))
        return conflict({ reason: "app_required", ...edge(requirer, fragment.id) });
      if (pulled && without.has(fragment.id))
        return conflict({
          reason: how === "required" ? "required" : "requires",
          ...edge(requirer, fragment.id),
        });
      return undefined;
    };

    const loadRequirement = (id: string, requirer: string | null, how: Via) =>
      Effect.gen(function* () {
        const fragment = yield* load(id, requirer);
        const problem = checkRequirement(fragment, requirer, how);
        if (problem) return yield* problem;
        return fragment;
      });

    const via = new Map<string, Via>();
    const state = new Map<string, "visiting" | "done">();
    const visitRequirements = (input: {
      fragment: Fragment;
      id: string;
      how: Via;
      path: ReadonlyArray<string>;
    }): Effect.Effect<void, NotFound | EntryInvalid | ComposeConflict | PermissionDenied> =>
      Effect.gen(function* () {
        const { fragment, id, how, path } = input;
        state.set(id, "visiting");
        const next: Via = how === "required" ? "required" : "requires";
        for (const required of fragment.meta.requires)
          yield* visit(required, id, next, [...path, id]);
        state.set(id, "done");
        if (!via.has(id)) via.set(id, how);
      });
    /** Depth first over `requires`: checks each edge and finds cycles. */
    const visit = (
      id: string,
      requirer: string | null,
      how: Via,
      path: ReadonlyArray<string>,
    ): Effect.Effect<void, NotFound | EntryInvalid | ComposeConflict | PermissionDenied> =>
      Effect.gen(function* () {
        if (existing.has(id)) return;
        const seen = state.get(id);
        if (seen === "visiting") return yield* cycleConflict(path, id);
        const fragment = yield* loadRequirement(id, requirer, how);
        // Checked per edge above, so the outcome doesn't depend on which edge was walked first.
        if (seen === "done") return;
        yield* visitRequirements({ fragment, id, how, path });
      });

    const selectRequired = Effect.gen(function* () {
      // 1. Required, with their requirements.
      for (const id of options.mode === "new" ? (stack?.meta.fragments.required ?? []) : [])
        yield* visit(id, null, "required", []);
    });
    yield* selectRequired;
    const defaults = options.mode === "new" ? (stack?.meta.fragments.default ?? []) : [];
    const selectDefaults = Effect.gen(function* () {
      // 2. Defaults, minus --without and the sandbox drops.
      for (const id of defaults) {
        if (without.has(id) || via.has(id)) continue;
        const fragment = yield* load(id, null);
        if (droppedBySandbox(fragment, sandbox)) continue;
        via.set(id, "default");
      }
    });
    yield* selectDefaults;
    // 3. The user's `always`, where it fits.
    const warnings: ComposeWarning[] = [];
    const alwaysFits = (fragment: Fragment) => {
      if (!stack || fits(fragment, stack)) return true;
      warnings.push({ code: "always_not_applicable", id: fragment.id });
      return false;
    };
    const selectAlways = (id: string) =>
      Effect.gen(function* () {
        if (without.has(id) || via.has(id)) return;
        if (!fragmentIds.has(id)) {
          warnings.push({ code: "always_unknown", id });
          return;
        }
        const fragment = yield* load(id, null);
        if (!alwaysFits(fragment) || droppedBySandbox(fragment, sandbox)) return;
        via.set(id, "always");
      });
    yield* Effect.forEach(options.always, selectAlways);
    const selectWith = (id: string) =>
      Effect.gen(function* () {
        // 4. --with, kept even when it doesn't fit or the sandbox would drop it.
        const fragment = yield* load(id, null);
        if (options.mode === "add" && stack && !fits(fragment, stack))
          return yield* conflict({ reason: "applies_to", ids: [id] });
        if (stack && !fits(fragment, stack)) warnings.push({ code: "with_not_applicable", id });
        if (via.get(id) !== "required") via.set(id, "with");
      });
    yield* Effect.forEach(withIds, selectWith);
    const warnExcluded = () => {
      for (const id of [...without].sort(byId))
        if (!(stack?.meta.fragments.default ?? []).includes(id) && !options.always.includes(id))
          warnings.push({ code: "without_not_selected", id });
    };
    warnExcluded();
    const visitSelected = Effect.gen(function* () {
      // 5. The requirements of everything selected so far.
      for (const id of [...via.keys()].sort(byId))
        yield* visit(id, null, via.get(id) ?? "requires", []);
    });
    yield* visitSelected;

    const selected = [...via.keys()].sort(byId).flatMap((id) => loaded.get(id) ?? []);
    const present = new Set([...existing, ...selected.map((fragment) => fragment.id)]);
    const loadApplied = Effect.gen(function* () {
      const appliedEntries: Fragment[] = [];
      for (const id of existing) {
        if (!fragmentIds.has(id)) continue;
        const entry = yield* load(id, null);
        appliedEntries.push(entry);
      }
      return appliedEntries;
    });
    const appliedEntries = yield* loadApplied;
    const checkConflicts = Effect.gen(function* () {
      // Existing fragments still participate in composition constraints.
      const apps = [...selected, ...appliedEntries]
        .filter(isApp)
        .map((fragment) => fragment.id)
        .sort(byId);
      if (apps.length > 1) return yield* conflict({ reason: "app_count", ids: apps });
      for (const fragment of [...selected, ...appliedEntries])
        for (const other of fragment.meta.conflicts)
          if (present.has(other))
            return yield* conflict({ reason: "conflicts", ids: [fragment.id, other].sort(byId) });
    });
    yield* checkConflicts;
    const checkFit = Effect.gen(function* () {
      // 8. Fit, for what the stack author or a requirement chose.
      for (const fragment of selected) {
        if (!stack && fragment.meta.appliesTo.length)
          warnings.push({ code: "with_not_applicable", id: fragment.id });
        const how = via.get(fragment.id);
        if (how !== "with" && how !== "always" && stack && !fits(fragment, stack))
          return yield* conflict({ reason: "applies_to", ids: [fragment.id] });
      }
    });
    yield* checkFit;

    return { stack, ordered: order(selected), via, warnings, existing };
  });
}

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
