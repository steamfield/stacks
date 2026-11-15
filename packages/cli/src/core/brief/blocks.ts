/**
 * The pieces both kinds of brief share: the verify step table and its command fence, the
 * commands and environment tables, the untrusted-entry list, the decisions list and the tool
 * status lines.
 *
 * `render.ts` writes the brief for `stacks new` and `render-add.ts` the one for `stacks add`; both
 * call into this file so a table or list reads the same in either. Entry text that lands in a
 * Markdown table cell goes through `cell`, which keeps it on one line and escapes `|`. Verify
 * commands never go in a table, because escaping would change them; they are printed verbatim in
 * a fenced block instead, so a command an agent copies is the command verify runs.
 */
import { DEFAULT_STEP_TIMEOUT } from "@steamfield/stacks-format";
import type { ComposedStep, Composition } from "../compose/types";
import type { Entry } from "../registry/entry";
import { HYGIENE_TAG } from "../verify/plan";
import * as T from "./text";
import type { BriefContext } from "./types";
import type { BriefWriter } from "./writer";

/** Verify's phase order; steps run phase by phase. */
const PHASES = ["setup", "check", "serve", "teardown"] as const;

/** Entry text folded onto one line, for headings, facts and list items. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Entry text made safe for one Markdown table cell. */
const cell = (text: string) => oneLine(text).replaceAll("|", "\\|");

/** Run order: by phase, then composition order within a phase. */
export function runOrder(steps: ReadonlyArray<ComposedStep>): ComposedStep[] {
  return PHASES.flatMap((phase) => steps.filter((step) => step.phase === phase));
}

/**
 * The verify table for steps already in run order, then each command in a fence, so a copied
 * command is the command run.
 */
export function writeStepTable(out: BriefWriter, ordered: ReadonlyArray<ComposedStep>): void {
  out.data(...stepTable(ordered));
  out.fixed("", T.done.commandsBelow, "");
  out.data(...commandFence(ordered));
}

/** What the `Expects` cell says about one step; empty when nothing is notable. */
function expectations(step: ComposedStep): string {
  return [
    ...(step.expect ? [T.done.within(step.expect.http, step.expect.within)] : []),
    ...(step.skipByDefault ? [T.done.skipped] : []),
    ...(step.tags.includes(HYGIENE_TAG) ? [T.done.hygiene] : []),
    ...(step.timeout !== DEFAULT_STEP_TIMEOUT ? [T.done.timeout(step.timeout)] : []),
  ].join("; ");
}

/** The verify table. A column no step in this table fills is left out. */
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
 * Each step's command as written, under a `# name` comment, in a fence longer than any backtick
 * run in the commands so none can close it.
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

/** The environment variables and their defaults as a table. */
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
 * The heading, the instruction to stop and the list of untrusted entries (Trust model point 3:
 * the agent must ask the user before using them). Each brief adds its own closing lines.
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

/** One line per dependency role: `- role: name, name`. */
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
