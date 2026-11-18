/**
 * Checks the verify steps a workspace mounts in its parts: each part's own steps and those of
 * every fragment placed on a part, listed by the workspace or not, since `add` places any fragment
 * that fits a part. Reads metadata only (trust point 1).
 */
import { Effect } from "effect";
import type { Finding } from "../../../schemas/validate";
import { partCwd, placement } from "../../compose/mount";
import type { PartMount } from "../../compose/types";
import { type Entry, isFragment, isStack, type Stack } from "../../registry/entry";
import type { Check, View } from "../types";
import { entryFile, finding } from "../view";

/** An entry as one workspace mounts it on one part. */
type Mounted = { workspace: Stack; entry: Entry; mount: PartMount };

export const partStepChecks: Check = (view) =>
  Effect.succeed({
    findings: mountedEntries(view).flatMap((mounted) => cwdFindings(view, mounted)),
  });

/** Every workspace's parts, then the fragments placed on them, from the resolution set. */
function mountedEntries(view: View): ReadonlyArray<Mounted> {
  const stacks = view.all.filter(isStack);
  const fragments = view.all.filter(isFragment);
  return stacks.flatMap((workspace): Mounted[] => {
    const mounts = (workspace.meta.parts ?? []).map(
      ({ name, role, stack }): PartMount => ({ name, role, stack }),
    );
    const parts = mounts.flatMap((mount) => {
      const entry = stacks.find((stack) => stack.id === mount.stack && !stack.meta.parts);
      return entry ? [{ workspace, entry, mount }] : [];
    });
    const placed = fragments.flatMap((entry) => {
      const mount = placement(entry.meta.appliesTo, workspace.id, mounts);
      return mount ? [{ workspace, entry, mount }] : [];
    });
    return [...parts, ...placed];
  });
}

const validated = (view: View, entry: Entry) => view.entries.some((item) => item.dir === entry.dir);

/**
 * Where a mounted entry's findings go, and how the message names the step's place: a validated
 * placed fragment's own file (naming the workspace), else the workspace's when it is validated
 * (naming the entry's file), else nowhere, since neither is under check.
 */
function reporter(view: View, { workspace, entry, mount }: Mounted) {
  if (isFragment(entry) && validated(view, entry))
    return { on: entry, where: `part ${mount.name} of ${workspace.id}` };
  if (!validated(view, workspace)) return undefined;
  return { on: workspace, where: `part ${mount.name}`, file: ` in ${entryFile(view, entry)}` };
}

/**
 * Each step whose `cwd` leaves the part directory, which compose refuses as `part_cwd`: at verify
 * time the step would still land inside the project, so only this catches it before an `add`.
 */
function cwdFindings(view: View, mounted: Mounted): Finding[] {
  const target = reporter(view, mounted);
  if (!target) return [];
  const { entry, mount } = mounted;
  const escaping = entry.meta.verify.filter((step) => partCwd(mount.name, step.cwd) === undefined);
  return escaping.map((step) =>
    finding(target.on, {
      check: "part-cwd",
      severity: "error",
      file: entryFile(view, target.on),
      message: `${target.where}: step ${step.name}${target.file ?? ""} has cwd "${step.cwd}", which leaves ${mount.name}/; keep cwd inside the part's directory`,
    }),
  );
}
