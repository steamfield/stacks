/**
 * Checks, for `stacks validate`, that every id an entry's frontmatter names points at a real entry.
 *
 * A stack lists the fragments it composes with (`fragments.required`, `default`, `optional`); a
 * fragment lists the fragments it `requires` or `conflicts` with and the stacks it `applies_to`. A
 * typo there would only surface when someone runs `stacks new`, so `index.ts` runs
 * `referenceChecks` over the `View`'s resolution set (every entry of every origin, the validated
 * root's entries winning). An id that resolves only to an entry outside the validated root is a
 * note naming that entry's origin, since the result then depends on what this machine holds.
 */
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { type Entry, isStack, type RejectedEntry } from "../registry/entry";
import { closest } from "../suggest";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

/** The resolution set split the way references read it. */
type Targets = {
  fragments: ReadonlyArray<Entry | RejectedEntry>;
  stacks: ReadonlyArray<Entry | RejectedEntry>;
  /** Every tag some loaded stack declares, which `applies_to` may name instead of a stack id. */
  tags: ReadonlySet<string>;
};

/** The frontmatter fields of an entry that name fragment ids, with the ids each holds. */
function namedFragments(entry: Entry): Array<[string, ReadonlyArray<string>]> {
  const { meta } = entry;
  if (meta.kind === "stack")
    return [
      ["fragments.required", meta.fragments.required],
      ["fragments.default", meta.fragments.default],
      ["fragments.optional", meta.fragments.optional],
    ];
  return [
    ["requires", meta.requires],
    ["conflicts", meta.conflicts],
  ];
}

/** A note for a reference that resolves only outside the validated root. */
const outsideRoot = (entry: Entry, file: string, message: string) =>
  finding(entry, { check: "resolved-outside-root", severity: "note", file, message });

/** A fragment id in `field`: unknown is an error with a did-you-mean, outside the root a note. */
function fragmentReference(
  view: View,
  targets: Targets,
  entry: Entry,
  reference: { field: string; id: string },
): Finding | undefined {
  const { field, id } = reference;
  const file = entryFile(view, entry);
  const target = targets.fragments.find((item) => item.id === id);
  if (target === undefined) {
    const near = closest(
      id,
      targets.fragments.map((item) => item.id),
    );
    return finding(entry, {
      check: "unknown-reference",
      severity: "error",
      file,
      message: `${field} names ${id}, which is no fragment${near.length ? `; did you mean ${near.join(", ")}?` : ""}`,
    });
  }
  if (view.inRoot(target)) return undefined;
  return outsideRoot(entry, file, `${field} names ${id}, found in the ${target.origin} registry`);
}

/** An `applies_to` value: a stack id (a note when outside the root) or a tag some stack declares. */
function appliesToReference(
  view: View,
  targets: Targets,
  entry: Entry,
  value: string,
): Finding | undefined {
  const file = entryFile(view, entry);
  const stack = targets.stacks.find((item) => item.id === value);
  if (stack !== undefined) {
    if (view.inRoot(stack)) return undefined;
    return outsideRoot(
      entry,
      file,
      `applies_to names ${value}, found in the ${stack.origin} registry`,
    );
  }
  if (targets.tags.has(value)) return undefined;
  return finding(entry, {
    check: "unknown-reference",
    severity: "error",
    file,
    message: `applies_to names ${value}, which is no stack id and no tag any stack declares`,
  });
}

/** Every reference one entry makes, in field order. */
function entryReferences(view: View, targets: Targets, entry: Entry): Array<Finding | undefined> {
  const named = namedFragments(entry).flatMap(([field, ids]) =>
    ids.map((id) => fragmentReference(view, targets, entry, { field, id })),
  );
  const appliesTo =
    entry.meta.kind === "fragment"
      ? entry.meta.appliesTo.map((value) => appliesToReference(view, targets, entry, value))
      : [];
  return [...named, ...appliesTo];
}

/**
 * Every id an entry names resolves in the resolution set: a stack's `fragments.*`, a fragment's
 * `requires` and `conflicts`, and `applies_to` values, which may be a stack id or a tag some
 * stack declares. A reference that resolves only outside the root is a note naming the origin,
 * since the result then depends on this machine; the bundled registry resolves only inside
 * itself, so there it is simply unknown.
 */
export const referenceChecks: Check = (view) =>
  Effect.sync(() => {
    const stacks = view.all.filter((item) => item.kind === "stack");
    const targets: Targets = {
      fragments: view.all.filter((item) => item.kind === "fragment"),
      stacks,
      tags: new Set(stacks.filter(isStack).flatMap((item) => item.meta.tags)),
    };
    const findings = view.entries
      .flatMap((entry) => entryReferences(view, targets, entry))
      .filter((found) => found !== undefined);
    return { findings };
  });
