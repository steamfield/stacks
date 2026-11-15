import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { type Entry, isStack } from "../registry/entry";
import { closest } from "../suggest";
import type { Check } from "./types";
import { entryFile, finding } from "./view";

/**
 * Every id an entry names resolves in the resolution set: a stack's `fragments.*`, a fragment's
 * `requires` and `conflicts`, and `applies_to` values, which may be a stack id or a tag some
 * stack declares. A reference that resolves only outside the root is a note naming the origin,
 * since the result then depends on this machine; the bundled registry resolves only inside
 * itself, so there it is simply unknown.
 */
export const referenceChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    const fragments = view.all.filter((item) => item.kind === "fragment");
    const stacks = view.all.filter((item) => item.kind === "stack");
    const tags = new Set(stacks.filter(isStack).flatMap((item) => item.meta.tags));
    const checkNamed = (entry: Entry) => {
      const file = entryFile(view, entry);
      const { meta } = entry;
      const named: Array<[string, ReadonlyArray<string>]> =
        meta.kind === "stack"
          ? [
              ["fragments.required", meta.fragments.required],
              ["fragments.default", meta.fragments.default],
              ["fragments.optional", meta.fragments.optional],
            ]
          : [
              ["requires", meta.requires],
              ["conflicts", meta.conflicts],
            ];
      const checkReference = (field: string, id: string) => {
        const target = fragments.find((item) => item.id === id);
        if (!target) {
          const near = closest(
            id,
            fragments.map((item) => item.id),
          );
          findings.push(
            finding(entry, {
              check: "unknown-reference",
              severity: "error",
              file,
              message: `${field} names ${id}, which is no fragment${near.length ? `; did you mean ${near.join(", ")}?` : ""}`,
            }),
          );
        } else if (!view.inRoot(target))
          findings.push(
            finding(entry, {
              check: "resolved-outside-root",
              severity: "note",
              file,
              message: `${field} names ${id}, found in the ${target.origin} registry`,
            }),
          );
      };
      for (const [field, ids] of named) for (const id of ids) checkReference(field, id);
    };
    const checkAppliesTo = (entry: Entry) => {
      const { meta } = entry;
      const file = entryFile(view, entry);
      if (meta.kind !== "fragment") return;
      const checkValue = (value: string) => {
        const stack = stacks.find((item) => item.id === value);
        if (stack) {
          if (!view.inRoot(stack))
            findings.push(
              finding(entry, {
                check: "resolved-outside-root",
                severity: "note",
                file,
                message: `applies_to names ${value}, found in the ${stack.origin} registry`,
              }),
            );
        } else if (!tags.has(value))
          findings.push(
            finding(entry, {
              check: "unknown-reference",
              severity: "error",
              file,
              message: `applies_to names ${value}, which is no stack id and no tag any stack declares`,
            }),
          );
      };
      for (const value of meta.appliesTo) checkValue(value);
    };
    for (const entry of view.entries) {
      checkNamed(entry);
      checkAppliesTo(entry);
    }
    return { findings };
  });
