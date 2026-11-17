/**
 * Checks whether a fragment’s conditional blocks can reach their named stacks. Manual selection
 * keeps an otherwise unused block reachable, so that case gets a note and a disallowed stack gets
 * a warning.
 */
import type { FragmentMeta } from "@steamfield/stacks-format";
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { scanConditionals } from "../compose/conditionals";
import { fitsStack } from "../compose/selection";
import { type Entry, isFragment, isStack } from "../registry/entry";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

export const conditionalReachChecks: Check = (view) =>
  Effect.sync(() => ({
    findings: view.entries.flatMap((entry) => entryReachFindings(view, entry)),
  }));

function entryReachFindings(view: View, entry: Entry): Finding[] {
  if (!isFragment(entry)) return [];
  const scanned = scanConditionals(entry.body);
  // `conditionalChecks` reports malformed markers.
  if (!("blocks" in scanned)) return [];
  return scanned.blocks.flatMap((block) =>
    (block.condition.stack ?? []).flatMap((id) => reachFinding(view, entry, id, block.start) ?? []),
  );
}

function reachFinding(
  view: View,
  entry: Entry & { meta: FragmentMeta },
  id: string,
  start: number,
): Finding | undefined {
  const stack = view.all.filter(isStack).find((item) => item.id === id);
  // `conditionalChecks` reports unknown stacks. A stack listing the fragment keeps the block.
  if (!stack || Object.values(stack.meta.fragments).some((ids) => ids.includes(entry.id)))
    return undefined;
  const allowed = fitsStack(entry.meta.appliesTo, { id: stack.id, tags: stack.meta.tags });
  return finding(entry, {
    check: "conditional-dead-branch",
    severity: allowed ? "note" : "warning",
    file: entryFile(view, entry),
    line: start + (view.sources.get(entry.dir)?.bodyOffset ?? 0),
    message: allowed
      ? `stack=${id} does not list ${entry.id} in its fragments; add it to fragments.default or fragments.optional, or select it with --with or add`
      : `stack=${id} cannot include ${entry.id}: its applies_to does not match`,
  });
}
