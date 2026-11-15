/**
 * Builds the `ComposeConflict` failures composition raises when entries can't be combined.
 *
 * A conflict names its parties, the stack and the fragments involved, in `details`, so the user or
 * agent can see which `--with` or `--without` to change. `selection.ts`, `plan-files.ts` and
 * `compose.ts` raise them; `errors.ts` owns the tag and how it prints.
 */
import { ComposeConflict } from "../../errors";
import type { Entry } from "../registry/entry";

type ConflictDetails = NonNullable<ComposeConflict["details"]>;
export const conflict = (details: ComposeConflict["details"]) => new ComposeConflict({ details });
/** The parties to a conflict, in reading order: the stack in `stack`, fragments in `ids`. */
export function parties(entries: ReadonlyArray<Entry>): Pick<ConflictDetails, "stack" | "ids"> {
  const stack = entries.find((entry) => entry.kind === "stack");
  const ids = [
    ...new Set(entries.filter((entry) => entry.kind === "fragment").map((entry) => entry.id)),
  ];
  return stack ? { stack: stack.id, ids } : { ids };
}
