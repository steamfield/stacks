import type { FailureKind } from "@steamfield/stacks-format";
import { changeLines } from "../../errors";
import type { StepResult, VerifyResult } from "../../schemas/verify";
import { type Audience, plainStyle, type Style, stripAnsi } from "../../services/output";
import { printable } from "../text";
import { nextLine } from "./next";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
/** One line of step output, safe for a terminal; tabs become spaces rather than escapes. */
export const outputLine = (line: string) => printable(stripAnsi(line).replaceAll("\t", "  "));

function stepLines(step: StepResult, width: number, partial: boolean, style: Style): string[] {
  const facts = [
    ...(step.exitCode !== undefined && step.status === "failed" ? [`exit ${step.exitCode}`] : []),
    ...(step.status === "skipped" ? [] : [seconds(step.durationMs)]),
  ].join(", ");
  // A selection never skips setup, so say why an unselected setup step failed the run.
  const why = [
    step.reason ?? step.note,
    ...(partial && step.status === "failed" && step.phase === "setup"
      ? ["setup always runs, even in a partial run"]
      : []),
  ]
    .filter(Boolean)
    .join("; ");
  const kind = { passed: "ok", failed: "error", skipped: "skip" } as const;
  const head = `  ${style(kind[step.status], step.status.padEnd(7))}  ${step.phase.padEnd(8)}  ${printable(step.name).padEnd(width)}`;
  const line = [head, facts && `(${facts})`, why && printable(why)].filter(Boolean).join("  ");
  const tail = step.outputTail
    ? step.outputTail.split("\n").map((text) => `      | ${outputLine(text)}`)
    : [];
  return [line.trimEnd(), ...tail];
}

function visibleSteps(result: VerifyResult, audience: Audience) {
  if (audience === "human") return result.steps;
  if (result.outcome === "changed") return [];
  return result.steps.filter((step) => step.status !== "passed");
}

/**
 * The text result: stage lines when present, a summary, accepted changes, one row per step
 * (a failed step's output tail under it), and for a run that isn't green the fixed `Next:`
 * line last. A human gets every row. An agent gets only the failed and skipped rows (the summary
 * counts the passed ones), and no rows on a `changed` run, where every step is skipped for the
 * same reason and the error's detail lines itemize the change.
 */
export function renderVerify(
  result: VerifyResult,
  context: { invocation: string; audience: Audience; style?: Style },
): string {
  const { invocation } = context;
  const style = context.style ?? plainStyle;
  const steps = visibleSteps(result, context.audience);
  // Aligned over every step, so a row reads the same whichever rows are shown.
  const width = Math.max(0, ...result.steps.map((step) => printable(step.name).length));
  const partial = result.scope === "partial";
  const { passed, failed, skipped } = result.totals;
  const header = `verify: ${result.outcome} (${result.scope} run; ${passed} passed, ${failed} failed, ${skipped} skipped; ${seconds(result.durationMs)})`;
  const kinds = result.steps.flatMap((step): FailureKind[] =>
    step.failureKind ? [step.failureKind] : [],
  );
  const next = nextLine(result.outcome, invocation, kinds, result.stages);
  return [
    ...(result.stages
      ? [`base: ${result.stages.base}`, `app: ${result.stages.app ?? "not run"}`]
      : []),
    header,
    ...(result.tamperCheck === "manifest-only"
      ? [
          "Tamper check: manifest only (no state record for this project on this machine), so this run can't count for the MVP gate.",
        ]
      : []),
    // A `changed` field on any other outcome is a change `--accept-changes` recorded.
    ...(result.changed && result.outcome !== "changed"
      ? [
          "Accepted the changed verify steps:",
          ...changeLines(result.changed).map((line) => `  ${line}`),
        ]
      : []),
    ...(steps.length
      ? ["", ...steps.flatMap((step) => stepLines(step, width, partial, style))]
      : []),
    ...(next ? ["", style("next", next)] : []),
  ].join("\n");
}
