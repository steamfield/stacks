/**
 * Builds composition conflicts with the entries involved so the user can tell which selection flags
 * to change.
 */
import { ComposeConflict } from "../../errors";
import type { Entry } from "../registry/entry";

type ConflictDetails = NonNullable<ComposeConflict["details"]>;
export const conflict = (details: ComposeConflict["details"]) => new ComposeConflict({ details });
/** Keep fragment ids in the order the entries were supplied. */
export function parties(entries: ReadonlyArray<Entry>): Pick<ConflictDetails, "stack" | "ids"> {
  const stack = entries.find((entry) => entry.kind === "stack");
  const ids = [
    ...new Set(entries.filter((entry) => entry.kind === "fragment").map((entry) => entry.id)),
  ];
  return stack ? { stack: stack.id, ids } : { ids };
}
