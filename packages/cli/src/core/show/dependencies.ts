/**
 * The dependency rollup `show` reports for a stack, agreeing with what `new` composes. A workspace
 * brings its parts' dependencies as its own, and every fragment placed on a part carries the
 * part's prefixed roles, whether the default composition holds it or it is only optional.
 */
import { type FragmentMeta, stackDependencies } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import { mountEntry, placement } from "../compose/mount";
import type { ComposedPart, Composition } from "../compose/types";
import { type Entry, type Fragment, isStack, type Stack } from "../registry/entry";

type Deps = Entry["meta"]["deps"];

/** Every dependency a stack brings, its own and its fragments'; `undefined` for a fragment. */
export const entryDependencyRollup = Effect.fn("show.dependencyRollup")(function* (
  entry: Entry,
  fragments: ReadonlyArray<Fragment>,
  composition: Composition | null,
) {
  if (!isStack(entry)) return undefined;
  // Composition already selects pinned snapshots and applies project/user overrides.
  const included = (composition?.fragments ?? []).flatMap((fragment) =>
    fragment.meta.kind === "fragment" ? [fragment.meta] : [],
  );
  const parts = composition?.parts ?? [];
  if (!parts.length)
    return stackDependencies(entry.meta, [...fragments.map(({ meta }) => meta), ...included]);
  const placed = yield* placeFragments(entry, fragments, parts);
  const deps = mergeDeps([entry.meta.deps, ...parts.map((part) => part.entry?.meta.deps ?? {})]);
  return stackDependencies({ ...entry.meta, deps }, [...placed, ...included]);
});

/**
 * The fragments' metas as `new` would mount them on this workspace's parts. One that can't be
 * mounted (a step `cwd` leaving its part) is left out, as an unresolvable fragment is.
 */
const placeFragments = (
  workspace: Stack,
  fragments: ReadonlyArray<Fragment>,
  parts: ReadonlyArray<ComposedPart>,
) =>
  Effect.gen(function* () {
    const mounts = parts.map((part) => part.mount);
    const root = { id: workspace.id, entry: workspace };
    const placed: FragmentMeta[] = [];
    for (const fragment of fragments) {
      const mount = placement(fragment.meta.appliesTo, workspace.id, mounts);
      const mounted = mount
        ? yield* Effect.result(mountEntry(fragment, mount, root))
        : Result.succeed(fragment);
      if (Result.isSuccess(mounted)) placed.push(mounted.success.meta);
    }
    return placed;
  });

/** Dependency roles merged in order; a name already under a role is kept once. */
function mergeDeps(all: ReadonlyArray<Deps>): Deps {
  const merged: Record<string, string[]> = {};
  for (const deps of all)
    for (const [role, names] of Object.entries(deps)) {
      const list = merged[role] ?? [];
      for (const name of names) if (!list.includes(name)) list.push(name);
      merged[role] = list;
    }
  return merged;
}
