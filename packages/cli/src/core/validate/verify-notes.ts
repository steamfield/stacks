/**
 * Notes gaps and repetition in what an entry's verify steps check, when `stacks validate` runs.
 *
 * Verify steps are the commands `stacks verify` runs in a project, its definition of done. Two
 * things are worth an author's attention without being wrong: a fragment with no verify step, so
 * nothing would catch its deliverable breaking (`fragment-no-verify`), and two steps of one
 * composed manifest running the same command (`verify-run-duplicate`). Both are notes, because a
 * fragment may have nothing checkable and a repeated command may be intended.
 *
 * `core/validate/index.ts` runs `verifyNotes`, which reads the compositions `composed.ts` already
 * rendered (`view.composed`). `add-compositions.ts` reuses `duplicateRuns` for the manifests that
 * `stacks add` would produce.
 */
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import type { Composition } from "../compose/types";
import { isFragment } from "../registry/entry";
import { uniqueFindings } from "./composed";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

/** Verification gaps are authoring notes, never warnings or composition failures. */
export const verifyNotes: Check = (view) =>
  Effect.gen(function* () {
    const { snapshots } = yield* view.composed;
    const findings = [
      ...missingVerifyNotes(view),
      ...snapshots.flatMap(({ composition }) => duplicateRunNotes(view, composition)),
    ];
    return { findings: uniqueFindings(findings) };
  });

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
