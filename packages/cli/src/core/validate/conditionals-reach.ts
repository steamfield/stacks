/**
 * Finds conditional blocks in a fragment's body that no real composition can ever keep.
 *
 * A fragment's guidance can hold `<!-- stacks:when stack=<id> -->` blocks: prose kept in the brief
 * (the task text the CLI writes for the coding agent) only when the fragment is composed onto that
 * stack. Such a block is dead when the named stack never brings the fragment in. If the
 * fragment's `applies_to` still admits the stack, the user can select it by hand (`--with` or
 * `stacks add`), so the finding is a note; if `applies_to` rules the stack out, the block can
 * never be kept and the finding is a warning.
 *
 * `validate/index.ts` runs `conditionalReachChecks`; `conditionals.ts` has already reported
 * malformed markers and unknown ids, so a body that doesn't scan is skipped here.
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
  if (!("blocks" in scanned)) return [];
  return scanned.blocks.flatMap((block) =>
    (block.condition.stack ?? []).flatMap((id) => reachFinding(view, entry, id, block.start) ?? []),
  );
}

/** The finding for a block naming stack `id` that starts on body line `start`, if it is dead. */
function reachFinding(
  view: View,
  entry: Entry & { meta: FragmentMeta },
  id: string,
  start: number,
): Finding | undefined {
  const stack = view.all.filter(isStack).find((item) => item.id === id);
  // An unknown stack is `conditional-ids`' error; a stack listing the fragment keeps the block.
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
