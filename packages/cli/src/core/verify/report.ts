/**
 * Renders a verify result as the text `stacks verify` prints for a person or an agent.
 *
 * `commands/verify.ts` passes the finished `VerifyResult` to `renderVerify`; `--json` output skips
 * this module and encodes the result directly. The report reads top to bottom: stage lines when
 * the project has an app stage, the summary line, notes about the tamper check and accepted
 * changes, one row per step, and a `Next:` line from `next.ts` when the run isn't green. The
 * agent rendering drops rows the summary already counts, as `.claude/rules/cli/cli.md` ("Three
 * audiences") asks. Step output is untrusted text, so every line of it passes `outputLine`, which
 * removes terminal escapes and control characters.
 */
import type { FailureKind } from "@steamfield/stacks-format";
import { changeLines } from "../../errors";
import type { StepResult, VerifyResult } from "../../schemas/verify";
import { type Audience, plainStyle, type Style, stripAnsi } from "../../services/output";
import { printable } from "../text";
import { nextLine } from "./next";
import { HYGIENE_SKIPPED } from "./plan";

const MANIFEST_ONLY_NOTE =
  "Tamper check: manifest only (no state record for this project on this machine), so this run can't count for the MVP gate.";
/** The `Style` kind each status is colored as. */
const STATUS_STYLE = { passed: "ok", failed: "error", skipped: "skip" } as const;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
/** One line of step output, safe for a terminal; tabs become spaces rather than escapes. */
export const outputLine = (line: string) => printable(stripAnsi(line).replaceAll("\t", "  "));

/** One step's row, then its output tail indented under it. */
function stepLines(step: StepResult, width: number, partial: boolean, style: Style): string[] {
  const facts = [
    ...(step.exitCode !== undefined && step.status === "failed" ? [`exit ${step.exitCode}`] : []),
    ...(step.status === "skipped" ? [] : [seconds(step.durationMs)]),
  ].join(", ");
  // `--only` never skips setup, so say why an unselected setup step failed the run.
  const why = [
    step.reason ?? step.note,
    ...(partial && step.status === "failed" && step.phase === "setup"
      ? ["setup always runs, even in a partial run"]
      : []),
  ]
    .filter(Boolean)
    .join("; ");
  const status = style(STATUS_STYLE[step.status], step.status.padEnd(7));
  const head = `  ${status}  ${step.phase.padEnd(8)}  ${printable(step.name).padEnd(width)}`;
  const line = [head, facts && `(${facts})`, why && printable(why)].filter(Boolean).join("  ");
  const tail = step.outputTail
    ? step.outputTail.split("\n").map((text) => `      | ${outputLine(text)}`)
    : [];
  return [line.trimEnd(), ...tail];
}

const hygieneSkip = (step: StepResult) =>
  step.status === "skipped" && step.reason === HYGIENE_SKIPPED;

/** The step rows an audience sees; an agent gets failed and skipped rows only. */
function visibleSteps(result: VerifyResult, audience: Audience) {
  if (audience === "human") return result.steps;
  if (result.outcome === "changed") return [];
  return result.steps.filter((step) => step.status !== "passed" && !hygieneSkip(step));
}

/** For an agent, skipped hygiene checks fold into one line instead of a row each. */
function hygieneLine(result: VerifyResult, audience: Audience, invocation: string): string[] {
  if (audience === "human" || result.outcome === "changed") return [];
  const count = result.steps.filter(hygieneSkip).length;
  if (count === 0) return [];
  return [
    "",
    `Skipped ${count} hygiene check${count === 1 ? "" : "s"} (fill markers, harness, CI, hooks); ${invocation} verify --all runs them.`,
  ];
}

function summaryLine(result: VerifyResult): string {
  const { passed, failed, skipped } = result.totals;
  return `verify: ${result.outcome} (${result.scope} run; ${passed} passed, ${failed} failed, ${skipped} skipped; ${seconds(result.durationMs)})`;
}

/** A `changed` field on any other outcome is a change `--accept-changes` recorded. */
function acceptedLines(result: VerifyResult): string[] {
  if (!result.changed || result.outcome === "changed") return [];
  return [
    "Accepted the changed verify steps:",
    ...changeLines(result.changed).map((line) => `  ${line}`),
  ];
}

/**
 * The text result: stage lines when present, a summary, accepted changes, one row per step
 * (a failed step's output tail under it), and for a run that isn't green the fixed `Next:`
 * line last. A human gets every row. An agent gets only the failed and skipped rows (the summary
 * counts the passed ones), with skipped hygiene checks as one line, and no rows on a `changed`
 * run, where every step is skipped for the same reason and the error's detail lines itemize the
 * change.
 */
export function renderVerify(
  result: VerifyResult,
  context: { invocation: string; audience: Audience; style?: Style },
): string {
  const { invocation, audience } = context;
  const style = context.style ?? plainStyle;
  const steps = visibleSteps(result, audience);
  // Aligned over every step, so a row reads the same whichever rows are shown.
  const width = Math.max(0, ...result.steps.map((step) => printable(step.name).length));
  const partial = result.scope === "partial";
  const kinds = result.steps.flatMap((step): FailureKind[] =>
    step.failureKind ? [step.failureKind] : [],
  );
  const next = nextLine(result.outcome, invocation, kinds, result.stages);
  return [
    ...(result.stages
      ? [`base: ${result.stages.base}`, `app: ${result.stages.app ?? "not run"}`]
      : []),
    summaryLine(result),
    ...(result.tamperCheck === "manifest-only" ? [MANIFEST_ONLY_NOTE] : []),
    ...acceptedLines(result),
    ...(steps.length
      ? ["", ...steps.flatMap((step) => stepLines(step, width, partial, style))]
      : []),
    ...hygieneLine(result, audience, invocation),
    ...(next ? ["", style("next", next)] : []),
  ].join("\n");
}
