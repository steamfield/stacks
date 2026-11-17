/** Renders shared Markdown blocks so tables and lists read the same in both briefs. */
import { DEFAULT_STEP_TIMEOUT } from "@steamfield/stacks-format";
import type { ComposedStep, Composition } from "../compose/types";
import type { Entry } from "../registry/entry";
import { HYGIENE_TAG } from "../verify/plan";
import * as T from "./text";
import type { BriefContext } from "./types";
import type { BriefWriter } from "./writer";

const PHASES = ["setup", "check", "serve", "teardown"] as const;

export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Fold and escape entry text so it occupies one Markdown table cell. */
const cell = (text: string) => oneLine(text).replaceAll("|", "\\|");

/** Match `planVerify` within a stage: phase order, with composition order breaking ties. */
export function runOrder(steps: ReadonlyArray<ComposedStep>): ComposedStep[] {
  return PHASES.flatMap((phase) => steps.filter((step) => step.phase === phase));
}

export function writeStepTable(out: BriefWriter, ordered: ReadonlyArray<ComposedStep>): void {
  out.data(...stepTable(ordered));
  out.fixed("", T.done.commandsBelow, "");
  out.data(...commandFence(ordered));
}

function expectations(step: ComposedStep): string {
  return [
    ...(step.expect ? [T.done.within(step.expect.http, step.expect.within)] : []),
    ...(step.skipByDefault ? [T.done.skipped] : []),
    ...(step.tags.includes(HYGIENE_TAG) ? [T.done.hygiene] : []),
    ...(step.timeout !== DEFAULT_STEP_TIMEOUT ? [T.done.timeout(step.timeout)] : []),
  ].join("; ");
}

/** Omit optional columns that no step fills. */
function stepTable(ordered: ReadonlyArray<ComposedStep>): string[] {
  const rows = ordered.map((step) => ({ step, expects: expectations(step) }));
  const layer = rows.some(({ step }) => step.layer !== undefined);
  const expects = rows.some((row) => row.expects !== "");
  const rowLine = ({ step, expects: expected }: (typeof rows)[number]) => {
    const cells = [
      cell(T.code(step.name)),
      step.phase,
      ...(layer ? [step.layer ?? ""] : []),
      ...(expects ? [cell(expected)] : []),
    ];
    return `| ${cells.join(" | ")} |`;
  };
  return [...T.done.tableHead({ layer, expects }), ...rows.map(rowLine)];
}

/**
 * Keep commands verbatim for copying because table escaping would change them. Use a fence
 * longer than any backtick run in the commands so their contents cannot close it.
 */
function commandFence(ordered: ReadonlyArray<ComposedStep>): string[] {
  const backtickRuns = ordered.flatMap((step) => step.run.match(/`+/g) ?? []);
  const longest = Math.max(0, ...backtickRuns.map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const stepLines = (step: ComposedStep) => [
    `# ${oneLine(step.name)}${step.cwd ? T.done.inDir(oneLine(step.cwd)) : ""}`,
    ...step.run.split("\n"),
  ];
  return [`${fence}sh`, ...ordered.flatMap(stepLines), fence];
}

/** A commands table under `heading`; nothing when there are no commands. */
export function writeCommandTable(
  out: BriefWriter,
  heading: string,
  commands: Record<string, string>,
): void {
  const entries = Object.entries(commands);
  if (entries.length === 0) return;
  out.gap();
  out.fixed(heading, "");
  out.data(
    ...T.done.commandsHead,
    ...entries.map(([name, purpose]) => `| ${cell(T.code(name))} | ${cell(purpose)} |`),
  );
}

export function envTable(env: Record<string, string>): string[] {
  return [
    ...T.done.environmentHead,
    ...Object.entries(env).map(
      ([key, value]) => `| ${cell(T.code(key))} | ${cell(T.code(value))} |`,
    ),
  ];
}

/** How to override a busy port (when a variable looks like one), and to leave the defaults alone. */
export function environmentNote(cli: string, keys: ReadonlyArray<string>): string[] {
  const port = keys.find((key) => /PORT/i.test(key));
  return [...(port ? [T.done.ports(cli, port)] : []), T.done.keepDefaults];
}

/** The definition of done's environment section; nothing when `env` is empty. */
export function writeEnvironment(out: BriefWriter, cli: string, env: Record<string, string>): void {
  const keys = Object.keys(env);
  if (keys.length === 0) return;
  out.gap();
  out.fixed(T.done.environment, "");
  out.data(...envTable(env));
  out.fixed("", ...environmentNote(cli, keys));
}

/**
 * Use the contributors from `untrustedEntries` to ask the agent to stop for the user's approval
 * (trust point 3). Each brief adds its own closing lines.
 */
export function writeUntrustedList(
  out: BriefWriter,
  untrusted: Composition<Entry | null>["untrusted"],
): void {
  out.fixed(T.untrusted.heading, "", T.untrusted.stop);
  out.data(
    ...untrusted.map((entry) => T.untrusted.entry(entry.kind, entry.id, entry.origin, entry.dir)),
  );
}

/** The decisions section; nothing when the composition has no decisions. */
export function writeDecisions(
  out: BriefWriter,
  decisions: Composition<Entry | null>["decisions"],
  yes: boolean,
): void {
  if (decisions.length === 0) return;
  out.gap();
  out.fixed(T.decisions.heading, "", yes ? T.decisions.yes : T.decisions.ask, "");
  out.data(...decisions.map((decision) => `- ${oneLine(decision.text)}`));
}

export function dependencyLines(deps: Composition<Entry | null>["deps"]): string[] {
  return deps.map((dep) => `- ${dep.role}: ${dep.names.join(", ")}`);
}

/** One line per required tool: missing (with how to install it), unchecked or found on PATH. */
export function toolLines(
  tools: Composition<Entry | null>["tools"],
  context: BriefContext,
): string[] {
  return tools.map(({ tool }) => {
    const missing = context.missing.find((item) => item.tool === tool);
    if (missing) return T.dependencies.missing(tool, T.installHint(tool), missing.drop);
    return context.toolsUnchecked ? T.dependencies.unchecked(tool) : T.dependencies.found(tool);
  });
}
