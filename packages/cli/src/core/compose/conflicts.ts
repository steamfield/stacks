/**
 * Builds composition conflicts with the entries involved so the user can tell which selection flags
 * to change.
 */
import { ComposeConflict } from "../../errors";
import type { MountedEntry } from "./types";

type ConflictDetails = NonNullable<ComposeConflict["details"]>;
export const conflict = (details: ComposeConflict["details"]) => new ComposeConflict({ details });
/**
 * Keep fragment ids in the order the entries were supplied. `stack` is the first unmounted stack
 * (the workspace, when it is a party), else the first stack; `parts` names every mounted party's
 * part, in party order, and is absent when none is mounted.
 */
export function parties(
  entries: ReadonlyArray<MountedEntry>,
): Pick<ConflictDetails, "stack" | "ids" | "parts"> {
  const stacks = entries.filter((entry) => entry.kind === "stack");
  const stack = stacks.find((entry) => !entry.mount) ?? stacks[0];
  const ids = [
    ...new Set(entries.filter((entry) => entry.kind === "fragment").map((entry) => entry.id)),
  ];
  const parts = [...new Set(entries.flatMap((entry) => (entry.mount ? [entry.mount.name] : [])))];
  return {
    ...(stack ? { stack: stack.id } : {}),
    ids,
    ...(parts.length ? { parts } : {}),
  };
}
