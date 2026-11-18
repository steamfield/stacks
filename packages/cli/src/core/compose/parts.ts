/**
 * What is wrong with a workspace's `parts` list, as data: compose refuses the first problem and
 * validate reports them all. Reads metadata only (trust point 1).
 */
import type { StackMeta, StackPart } from "@steamfield/stacks-format";
import { isClientRole, knownRole } from "./roles";

export type PartProblem = {
  reason: "part_stack" | "part_role" | "part_name_duplicate" | "part_nested" | "part_roles";
  /** The part the problem is on; absent for the role count, which is about the whole list. */
  part?: string;
};

/** One part's problems: its name taken, then its stack missing or a workspace, then its role. */
function problemsOf(
  part: StackPart,
  seen: ReadonlySet<string>,
  lookup: (stackId: string) => StackMeta | undefined,
): PartProblem[] {
  const problems: PartProblem[] = [];
  const at = (reason: PartProblem["reason"]) => problems.push({ reason, part: part.name });
  if (seen.has(part.name)) at("part_name_duplicate");
  const meta = lookup(part.stack);
  if (!meta) at("part_stack");
  else if (meta.parts) at("part_nested");
  if (!knownRole(part.role)) at("part_role");
  return problems;
}

/** Version 1 takes exactly one `api` part and exactly one client part. */
const rolesCounted = (parts: ReadonlyArray<StackPart>) =>
  parts.filter((part) => part.role === "api").length === 1 &&
  parts.filter((part) => isClientRole(part.role)).length === 1;

/**
 * In parts order: duplicate name, unknown stack, nested, unknown role; then the role count (no
 * `part`). The count is checked only when no part has a problem of its own, since an unknown or
 * missing part would otherwise be reported a second time as a wrong count.
 */
export function partProblems(
  parts: ReadonlyArray<StackPart>,
  lookup: (stackId: string) => StackMeta | undefined,
): ReadonlyArray<PartProblem> {
  const seen = new Set<string>();
  const problems: PartProblem[] = [];
  for (const part of parts) {
    problems.push(...problemsOf(part, seen, lookup));
    seen.add(part.name);
  }
  if (!problems.length && !rolesCounted(parts)) problems.push({ reason: "part_roles" });
  return problems;
}
