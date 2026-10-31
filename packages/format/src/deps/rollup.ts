import { Schema } from "effect";
import type { FragmentMeta, StackMeta } from "../entry.js";

/** One package a stack brings, with every entry that declares it. */
export const RolledDependency = Schema.Struct({
  role: Schema.String,
  name: Schema.String,
  /** The stack itself declares it. */
  stack: Schema.Boolean,
  /** Fragment ids that declare it, sorted. */
  fragments: Schema.Array(Schema.String),
});
export type RolledDependency = typeof RolledDependency.Type;

/**
 * A stack's dependencies: `included` is the stack's own plus its required and default fragments'
 * (with their `requires`); `optional` is what each optional fragment would add, sorted by id.
 * Rows keep declaration order: the stack's own first, then each fragment's by fragment id.
 */
export const DependencyRollup = Schema.Struct({
  included: Schema.Array(RolledDependency),
  optional: Schema.Array(
    Schema.Struct({ fragment: Schema.String, deps: Schema.Array(RolledDependency) }),
  ),
});
export type DependencyRollup = typeof DependencyRollup.Type;

type Fragment = typeof FragmentMeta.Type;
type Source = { readonly id: string | null; readonly deps: Fragment["deps"] };

const key = (role: string, name: string) => `${role}\u0000${name}`;
const byText = (a: string, b: string) => (a < b ? -1 : Number(a > b));

/** Fragment ids reachable from `ids` through `requires`, leaving out `skip` and unknown ids. */
function closure(
  ids: Iterable<string>,
  byId: ReadonlyMap<string, Fragment>,
  skip: ReadonlySet<string>,
): Set<string> {
  const seen = new Set<string>();
  const visit = (id: string): void => {
    const fragment = byId.get(id);
    if (seen.has(id) || skip.has(id) || fragment === undefined) return;
    seen.add(id);
    for (const required of fragment.requires) visit(required);
  };
  for (const id of ids) visit(id);
  return seen;
}

type Row = { role: string; name: string; stack: boolean; fragments: string[] };

function addSource(rows: Map<string, Row>, source: Source, exclude: ReadonlySet<string>): void {
  for (const [role, names] of Object.entries(source.deps))
    for (const name of names) {
      const id = key(role, name);
      if (exclude.has(id)) continue;
      const row = rows.get(id) ?? { role, name, stack: false, fragments: [] };
      if (source.id === null) row.stack = true;
      else if (!row.fragments.includes(source.id)) row.fragments.push(source.id);
      rows.set(id, row);
    }
}

function collect(
  sources: ReadonlyArray<Source>,
  exclude: ReadonlySet<string>,
): Array<RolledDependency> {
  const rows = new Map<string, Row>();
  for (const source of sources) addSource(rows, source, exclude);
  return [...rows.values()];
}

/**
 * Every dependency a stack brings, attributed to the entries that declare it. `fragments` must
 * hold the stack's fragments and everything they require; ids missing from it are skipped.
 */
export function stackDependencies(
  stack: typeof StackMeta.Type,
  fragments: ReadonlyArray<Fragment>,
): DependencyRollup {
  const byId = new Map(fragments.map((fragment) => [fragment.id, fragment]));
  const sourcesOf = (ids: Iterable<string>): Source[] =>
    [...ids].toSorted(byText).flatMap((id) => {
      const fragment = byId.get(id);
      return fragment === undefined ? [] : [{ id, deps: fragment.deps }];
    });
  const base = closure([...stack.fragments.required, ...stack.fragments.default], byId, new Set());
  const included = collect([{ id: null, deps: stack.deps }, ...sourcesOf(base)], new Set());
  const have = new Set(included.map((row) => key(row.role, row.name)));
  const optional = [...new Set(stack.fragments.optional)]
    .filter((id) => !base.has(id))
    .toSorted(byText)
    .map((fragment) => ({
      fragment,
      deps: collect(sourcesOf(closure([fragment], byId, base)), have),
    }))
    .filter((entry) => entry.deps.length > 0);
  return { included, optional };
}
