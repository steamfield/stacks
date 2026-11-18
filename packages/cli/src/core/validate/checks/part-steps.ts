/**
 * Checks the verify steps a workspace mounts in its parts: each part's own steps and those of
 * every fragment placed on a part, listed by the workspace or not, since `add` places any fragment
 * that fits a part. Reads metadata only (trust point 1).
 */
import type { VerifyStep } from "@steamfield/stacks-format";
import { Effect } from "effect";
import type { Finding } from "../../../schemas/validate";
import { atSessionRoot, partCwd, placement } from "../../compose/mount";
import { partProblems } from "../../compose/parts";
import type { PartMount } from "../../compose/types";
import { type Entry, isFragment, isStack, type Stack } from "../../registry/entry";
import { shellWords } from "../../text/shell";
import type { Check, View } from "../types";
import { entryFile, finding } from "../view";

/** An entry as one workspace mounts it on one part. */
type Mounted = { workspace: Stack; entry: Entry; mount: PartMount };

/** A finding about one mounted step: its check, severity, step name and what is wrong with it. */
type Report = (
  check: string,
  severity: Finding["severity"],
  step: VerifyStep,
  problem: string,
) => Finding;

export const partStepChecks: Check = (view) =>
  Effect.succeed({
    findings: mountedEntries(view).flatMap((mounted) => {
      const report = reporter(view, mounted);
      return report
        ? [...cwdFindings(mounted, report), ...sessionRootFindings(mounted, report)]
        : [];
    }),
  });

/**
 * Every workspace's parts, then the fragments placed on them, from the resolution set. A parts
 * list with a problem (`workspaceChecks` reports it) places nothing, since which mount a fragment
 * lands on depends on the list being sound.
 */
function mountedEntries(view: View): ReadonlyArray<Mounted> {
  const stacks = view.all.filter(isStack);
  const fragments = view.all.filter(isFragment);
  const lookup = (id: string) => stacks.find((stack) => stack.id === id)?.meta;
  return stacks.flatMap((workspace): Mounted[] => {
    const declared = workspace.meta.parts ?? [];
    const mounts = declared.map(({ name, role, stack }): PartMount => ({ name, role, stack }));
    const parts = mounts.flatMap((mount) => {
      const entry = stacks.find((stack) => stack.id === mount.stack && !stack.meta.parts);
      return entry ? [{ workspace, entry, mount }] : [];
    });
    if (partProblems(declared, lookup).length) return parts;
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
function reporter(view: View, { workspace, entry, mount }: Mounted): Report | undefined {
  const own = isFragment(entry) && validated(view, entry);
  if (!own && !validated(view, workspace)) return undefined;
  const on = own ? entry : workspace;
  const where = own ? `part ${mount.name} of ${workspace.id}` : `part ${mount.name}`;
  const file = own ? "" : ` in ${entryFile(view, entry)}`;
  return (check, severity, step, problem) =>
    finding(on, {
      check,
      severity,
      file: entryFile(view, on),
      message: `${where}: step ${step.name}${file} ${problem}`,
    });
}

/**
 * Each step whose `cwd` leaves the part directory, which compose refuses as `part_cwd`: at verify
 * time the step would still land inside the project, so only this catches it before an `add`.
 */
function cwdFindings({ entry, mount }: Mounted, report: Report): Finding[] {
  return entry.meta.verify
    .filter((step) => partCwd(mount.name, step.cwd) === undefined)
    .map((step) =>
      report(
        "part-cwd",
        "error",
        step,
        `has cwd "${step.cwd}", which leaves ${mount.name}/; keep cwd inside the part's directory`,
      ),
    );
}

/**
 * Each step whose command names a session-root path (`atSessionRoot`): mounting writes that path
 * at the project root, but the step runs in the part directory, where it doesn't exist.
 */
function sessionRootFindings({ entry, mount }: Mounted, report: Report): Finding[] {
  return entry.meta.verify.flatMap((step) => {
    const named = sessionRootWords(step.run);
    if (!named.length) return [];
    return [
      report(
        "part-step-session-root",
        "warning",
        step,
        `names ${named.join(", ")}, which stacks writes at the project root while the step runs in ${mount.name}/; reach them as ../<path> or move the step to the workspace`,
      ),
    ];
  });
}

/** The words of a command that are session-root paths, `./` dropped, each once. */
function sessionRootWords(run: string): ReadonlyArray<string> {
  const paths = shellWords(run)
    .map((word) => word.replace(/^(\.\/)+/, ""))
    .filter((word) => atSessionRoot(word) || atSessionRoot(`${word}/`));
  return [...new Set(paths)];
}
