/**
 * Notes missing fragment checks and duplicate verify commands. These are notes because some
 * fragments have nothing checkable and a repeat can be intentional.
 */
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import type { Composition } from "../compose/types";
import { isFragment } from "../registry/entry";
import { uniqueFindings } from "./composed";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

export const verifyNotes: Check = (view) =>
  Effect.gen(function* () {
    const { snapshots } = yield* view.composed;
    const findings = [
      ...missingVerifyNotes(view),
      ...snapshots.flatMap(({ composition }) => duplicateRunNotes(view, composition)),
    ];
    return { findings: uniqueFindings(findings) };
  });

/** Without a verify step, the fragment supplies no check that its deliverable still works. */
function missingVerifyNotes(view: View): Finding[] {
  return view.entries
    .filter(isFragment)
    .filter((fragment) => fragment.meta.verify.length === 0)
    .map((fragment) =>
      finding(fragment, {
        check: "fragment-no-verify",
        severity: "note",
        file: entryFile(view, fragment),
        message:
          "This fragment has no verify step; add a check for its deliverable, or explain in its body why it cannot be checked.",
      }),
    );
}

/**
 * A note for each command run by more than one step of the composition, placed on the first
 * validated entry in it (the stack, then its fragments). A composition holding no validated entry
 * gets none.
 */
function duplicateRunNotes(view: View, composition: Composition): Finding[] {
  const owner = [composition.stack, ...composition.fragments].find((entry) =>
    view.entries.some((wanted) => wanted.dir === entry.dir),
  );
  if (!owner) return [];
  return duplicateRuns(composition.verify).map((names) =>
    finding(owner, {
      check: "verify-run-duplicate",
      severity: "note",
      file: entryFile(view, owner),
      message: `Steps ${names.join(", ")} run the same command in one composed manifest; keep both only if the repetition is intentional.`,
    }),
  );
}

/** The names of steps that share a `run` command, one group per command run more than once. */
export function duplicateRuns(
  steps: ReadonlyArray<Pick<Composition["verify"][number], "run" | "name">>,
): string[][] {
  const commands = new Map<string, string[]>();
  for (const step of steps) commands.set(step.run, [...(commands.get(step.run) ?? []), step.name]);
  return [...commands.values()].filter((names) => names.length > 1);
}
