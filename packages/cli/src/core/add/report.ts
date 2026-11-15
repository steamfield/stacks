/**
 * Turns the result of `stacks add` into the text summary a person or an agent reads.
 *
 * `commands/add.ts` calls `renderAdd` for the `human` and `agent` audiences (`--json` prints the
 * result object instead). It borrows `warningLine` and `missingLine` from `scaffold/report.ts`, so
 * `new` and `add` describe a warning or a missing tool the same way. The `Stop:` line appears when
 * an untrusted step's digest wasn't recorded (Trust model point 4).
 */
import type { AddResult } from "../../schemas/add";
import type { Audience } from "../../services/output";
import { missingLine, warningLine } from "../scaffold/report";
import { printable } from "../text";

/** The add summary; callers shorten project and untrusted paths with shownPath for agents. */
export function renderAdd(
  result: Omit<AddResult, "handoff">,
  context: { shown: string; audience: Audience; invocation: string },
): string {
  return [
    `Added ${result.added.map(printable).join(", ")}${context.shown === "." ? "" : ` to ${printable(context.shown)}`}`,
    ...(result.written.length ? [`Written: ${result.written.map(printable).join(", ")}`] : []),
    ...(result.skipped.length ? [`Skipped: ${result.skipped.map(printable).join(", ")}`] : []),
    // `drop` names new's flags, which don't exist for add.
    ...result.missingTools.map((item) => `Missing tool: ${missingLine({ ...item, drop: [] })}`),
    // missingTools above says the same as each missing_tool warning, with its owners.
    ...result.warnings
      .filter((warning) => warning.code !== "missing_tool")
      .map((warning) => `Warning: ${warningLine(warning)}`),
    ...(result.mergeNeeded.length
      ? [
          "",
          "Merge needed",
          ...result.mergeNeeded.flatMap((item) =>
            item.incoming.map((incoming) => `  ${printable(item.path)}: ${printable(incoming)}`),
          ),
        ]
      : []),
    ...result.missingRequired.map(
      (item) => `Missing required: ${printable(item.id)}. Next: ${printable(item.command)}`,
    ),
    ...result.untrusted.map(
      (entry) => `Untrusted: ${printable(entry.id)} (${entry.origin}): ${printable(entry.dir)}`,
    ),
    ...(!result.digestRecorded
      ? [
          `Stop: ask the user to review the new steps and run ${context.invocation} verify --accept-changes in their terminal.`,
        ]
      : []),
    `Brief: ${result.brief}`,
  ].join("\n");
}
