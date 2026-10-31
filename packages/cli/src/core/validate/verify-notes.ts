import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import type { Composition } from "../compose/compose";
import { isFragment } from "../registry/entry";
import { uniqueFindings } from "./composed";
import { type Check, entryFile, finding } from "./view";

/** Verification gaps are authoring notes, never warnings or composition failures. */
export const verifyNotes: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = view.entries
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
    for (const { composition } of (yield* view.composed).snapshots) {
      const owner = [composition.stack, ...composition.fragments].find((entry) =>
        view.entries.some((wanted) => wanted.dir === entry.dir),
      );
      if (!owner) continue;
      for (const names of duplicateRuns(composition.verify))
        findings.push(
          finding(owner, {
            check: "verify-run-duplicate",
            severity: "note",
            file: entryFile(view, owner),
            message: `Steps ${names.join(", ")} run the same command in one composed manifest; keep both only if the repetition is intentional.`,
          }),
        );
    }
    return { findings: uniqueFindings(findings) };
  });

export function duplicateRuns(
  steps: ReadonlyArray<Pick<Composition["verify"][number], "run" | "name">>,
): string[][] {
  const commands = new Map<string, string[]>();
  for (const step of steps) commands.set(step.run, [...(commands.get(step.run) ?? []), step.name]);
  return [...commands.values()].filter((names) => names.length > 1);
}
