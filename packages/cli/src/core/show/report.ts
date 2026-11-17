/**
 * Renders entry reviews for people and agents. It shows every guidance branch so reviewers can
 * inspect the full entry and uses `printable` to keep untrusted text from steering the terminal.
 */
import type { RolledDependency, StackStatsDetail } from "@steamfield/stacks-format";
import type { ShowReport } from "../../schemas/show";
import { plainStyle, type Style } from "../../services/output";
import { goAllowlistKey } from "../deps/index";
import { DEFAULT_PAYLOAD } from "../registry/entry";
import { statsFields, statsLine } from "../stats/text";
import { printable } from "../text/text";
import { wrap, wrapWords } from "../text/wrap";
import { BUDGET } from "../validate/compositions/budget";

/** The terminal width and the display-width measure that wraps human text. */
type Layout = { width: number; measure: (text: string) => number };

const DAY_MS = 86_400_000;

/** `line` with control characters escaped; tabs are kept so indented guidance stays aligned. */
const safeLine = (line: string) => line.split("\t").map(printable).join("\t");

const listOrNone = (values: ReadonlyArray<string>) => (values.length ? values.join(", ") : "none");

const count = (value: number) => value.toLocaleString("en-US");

export function renderShow(
  report: ShowReport,
  invocation: string,
  layout?: Layout,
  style: Style = plainStyle,
): string {
  const wrapped = (line: string) =>
    layout ? wrapWords(line, layout.width, layout.measure).split("\n") : [line];
  const lines = [
    titleLine(report),
    ...plainLines(report.plain).flatMap(wrapped),
    ...metadataLines(report, layout !== undefined),
    ...selectionLines(report),
    ...payloadLines(report.payloads),
    ...verifyLines(report.verify),
    ...fileLines(report.files),
    ...sizeLines(report),
    lastRunLine(report.lastRun),
    ...statsLines(report.stats).flatMap((line) =>
      line.startsWith("Stats:") ? wrapped(line) : [line],
    ),
    "",
    "--- guidance ---",
    ...guidanceLines(report.body, layout),
    "",
    nextLine(report, invocation),
  ];
  return lines
    .map((line) => {
      const safe = safeLine(line);
      return safe.startsWith("Next:") ? style("next", safe) : safe;
    })
    .join("\n");
}

function titleLine(report: ShowReport): string {
  const trust = report.trusted ? "trusted" : "untrusted";
  return `${report.name} (${report.id}), ${report.kind}, origin ${report.origin}, ${trust}`;
}

/** The sidecar's plain-language copy, with notes on where it came from and how current it is. */
function plainLines(plain: ShowReport["plain"]): string[] {
  if (!plain) return [];
  return [
    plain.whatItIs,
    ...(plain.stale ? ["(written for an earlier version of this entry)"] : []),
    ...(plain.unreviewed ? ["(from the entry's author, not reviewed by stacks)"] : []),
    ...plain.goodAt.map((text) => `Good at: ${text}`),
    ...(plain.example ? [`Example: ${plain.example.title} — ${plain.example.description}`] : []),
    ...plain.notGoodAt.map((text) => `Not good at: ${text}`),
  ];
}

function metadataLines(report: ShowReport, human: boolean): string[] {
  return [
    report.description,
    ...(report.author === undefined ? [] : [`Author: @${report.author}`]),
    `Path: ${report.path}`,
    `Shadows: ${listOrNone(report.shadows)}`,
    `Tags: ${listOrNone(report.tags)}`,
    ...dependencyLines(report, human),
    `Tools: ${listOrNone(report.tools)}`,
    ...(report.decisions.length
      ? ["Decisions:", ...report.decisions.map((decision) => `  - ${decision}`)]
      : ["Decisions: none"]),
    ...Object.entries(report.env).map(([key, value]) => `Environment: ${key}=${value}`),
    ...Object.entries(report.commands).map(([key, value]) => `Command: ${key}: ${value}`),
  ];
}

/** One line per dependency role, then one per optional fragment that would add dependencies. */
function dependencyLines(report: ShowReport, human: boolean): string[] {
  const included = dependencyGroups(report).flatMap(({ role, deps }) =>
    role === "app" && human && deps.length > 0
      ? appDependencyLines(report, deps)
      : [`Dependencies (${role}): ${listOrNone(deps.map((dep) => dep.label))}`],
  );
  const optional = report.kind === "stack" ? (report.dependencyRollup?.optional ?? []) : [];
  return [...included, ...optional.map(optionalDependencyLine)];
}

type DependencyLabel = { name: string; label: string };

/**
 * Dependencies grouped by role. A fragment, or a stack without a rollup, lists its own `deps`; a
 * stack with one lists everything included, each labeled with the fragments it came from.
 */
function dependencyGroups(report: ShowReport) {
  if (report.kind !== "stack" || report.dependencyRollup === undefined)
    return Object.entries(report.deps).map(([role, names]) => ({
      role,
      deps: names.map((name) => ({ name, label: name })),
    }));
  const groups = new Map<string, DependencyLabel[]>();
  for (const dep of report.dependencyRollup.included) {
    const group = groups.get(dep.role) ?? [];
    group.push({ name: dep.name, label: dep.name + dependencySource(dep, dep.stack) });
    groups.set(dep.role, group);
  }
  // Keep explicit empty roles visible, including the human app role's "none" row.
  for (const [role, names] of Object.entries(report.deps))
    if (!names.length && !groups.has(role)) groups.set(role, []);
  return [...groups].map(([role, deps]) => ({ role, deps }));
}

/** ` (from <fragments>)` after a dependency a fragment brought; nothing for the stack's own. */
function dependencySource(dep: RolledDependency, own: boolean): string {
  return own ? "" : ` (from ${dep.fragments.join(", ")})`;
}

/** The human view of app dependencies: one per line, with its card's summary when it has one. */
function appDependencyLines(report: ShowReport, deps: ReadonlyArray<DependencyLabel>): string[] {
  return [
    "Dependencies (app):",
    ...deps.map(({ name, label }) => {
      const card = dependencyCard(report, name);
      return `  ${label}${card ? `: ${card.whatItIs}` : ""}`;
    }),
  ];
}

/** The card for dependency `name` in any ecosystem, only when exactly one ecosystem has one. */
function dependencyCard(report: ShowReport, name: string) {
  const matches = Object.entries(report.dependencyCards ?? {}).filter(
    ([key]) =>
      key.slice(key.indexOf("/") + 1) === (key.startsWith("go/") ? goAllowlistKey(name) : name),
  );
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

function optionalDependencyLine({
  fragment,
  deps,
}: NonNullable<ShowReport["dependencyRollup"]>["optional"][number]): string {
  const labels = deps.map(
    (dep) =>
      `${dep.name} (${dep.role})${dependencySource(
        dep,
        dep.fragments.every((id) => id === fragment),
      )}`,
  );
  return `Optional dependencies (with ${fragment}): ${labels.join(", ")}`;
}

/** A stack's fragment lists, or a fragment's fit fields; one or the other is present. */
function selectionLines(report: ShowReport): string[] {
  const lines: string[] = [];
  if (report.fragments)
    lines.push(
      `Fragments: required ${listOrNone(report.fragments.required)}; default ${listOrNone(report.fragments.default)}; optional ${listOrNone(report.fragments.optional)}`,
    );
  if (report.category)
    lines.push(
      `Category: ${report.category}`,
      `Applies to: ${listOrNone(report.appliesTo ?? [])}`,
      `Fits: ${listOrNone(report.fits ?? [])}`,
      `Requires: ${listOrNone(report.requires ?? [])}`,
      `Conflicts: ${listOrNone(report.conflicts ?? [])}`,
      `Requires tools: ${listOrNone(report.requiresTools ?? [])}`,
      `Needs own repository: ${report.needsOwnRepo ? "yes" : "no"}`,
    );
  return lines;
}

/** Each step as `name: run`, with its other fields after it, e.g. `(phase setup, layer install)`. */
function verifyLines(steps: ShowReport["verify"]): string[] {
  return [
    "Verify:",
    ...steps.map(({ name, run, ...rest }) => {
      const extra = Object.entries(rest).map(
        ([key, value]) => `${key} ${typeof value === "string" ? value : JSON.stringify(value)}`,
      );
      return `  ${name}: ${run}${extra.length ? ` (${extra.join(", ")})` : ""}`;
    }),
  ];
}

/** Available payload variants and the flag that leaves out the example, when supported. */
function payloadLines(payloads: ShowReport["payloads"]): string[] {
  if (!payloads?.length) return [];
  const variants = payloads.map((id) => (id === DEFAULT_PAYLOAD ? `${id} (default)` : id));
  const hint = payloads.includes("none")
    ? " Pass --payload none to start without the example."
    : "";
  return [`Payloads: ${variants.join(", ")}.${hint}`];
}

/** Each shipped file as `project path <- source`, with its agent, stack or payload condition. */
function fileLines(files: ShowReport["files"]): string[] {
  if (!files.length) return ["Files:", "  none"];
  return [
    "Files:",
    ...files.map(
      (file) =>
        `  ${file.path}${file.agent ? ` (${file.agent})` : ""}${file.stack ? ` (stack ${file.stack})` : ""}${file.payload ? ` (payload ${file.payload})` : ""} <- ${file.source}`,
    ),
  ];
}

/** Word counts of the body and, for a stack, of its default brief, against their caps. */
function sizeLines(report: ShowReport): string[] {
  const body = `Body: ${count(report.bodyWords)} words (cap ${count(report.bodyCap)})`;
  if (report.briefWords === null) return [body];
  return [
    body,
    `Brief: ${count(report.briefWords)} words with defaults (cap ${count(report.briefCap)}; ${count(BUDGET.composedWithApp)} with an app)`,
  ];
}

function lastRunLine(lastRun: ShowReport["lastRun"]): string {
  if (!lastRun) return "Last run: none";
  const on = lastRun.stack ? ` on ${lastRun.stack}` : "";
  const content = lastRun.sameContent ? "same content" : "changed content";
  return `Last run: ${lastRun.result} ${lastRun.date}${on}, ${content}`;
}

/**
 * The `Stats:` line, and for a stack the steps that most often fail before a first green and the
 * latest content change inside the stats window.
 */
function statsLines(stats: ShowReport["stats"]): string[] {
  if (!stats?.published) return [];
  const lines = [statsLine(statsFields(stats, stats))];
  if (stats.kind !== "stack") return lines;
  const steps = topFailingSteps(stats);
  if (steps.length)
    lines.push(
      "Steps failing before first green:",
      ...steps.map(({ name, value }) => `  ${name} ${Math.round(value * 100)}%`),
    );
  const latest = latestContentChange(stats);
  if (latest && latest > windowStart(stats)) lines.push(`content changed ${latest}`);
  return lines;
}

/** Up to three published step-failure shares, largest first, ties by step name. */
function topFailingSteps(stats: StackStatsDetail) {
  return Object.entries(stats.stepFailureShares)
    .flatMap(([name, share]) => (share.suppressed ? [] : [{ name, value: share.value }]))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, 3);
}

/** The first day (`YYYY-MM-DD`, UTC) of the window that ends on `through`. */
function windowStart(stats: StackStatsDetail): string {
  const through = Date.parse(`${stats.through}T00:00:00Z`);
  return new Date(through - (stats.window - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** The latest day any series point records a content change, if any. */
function latestContentChange(stats: StackStatsDetail): string | undefined {
  return stats.series
    .flatMap((point) => point.changes.map((change) => change.day))
    .sort()
    .at(-1);
}

function guidanceLines(body: string, layout: Layout | undefined): string[] {
  const text = body.trimEnd();
  if (!layout) return text.split("\n");
  // Escape before wrapping, so widths are measured on the text that will be printed.
  const escaped = text.split("\n").map(safeLine).join("\n");
  return wrap(escaped, layout.width, layout.measure).split("\n");
}

/** What to try next: a fragment on a stack, an index stack in a dry run, or a stack's brief. */
function nextLine(report: ShowReport, invocation: string): string {
  if (report.kind === "fragment") return `Next: ${invocation} new <stack> --with ${report.id}`;
  if (report.origin === "index")
    return `Next: ${invocation} new ${report.id} --dry-run --sandbox --no-launch`;
  return `Next: ${invocation} validate --brief ${report.id} --sandbox`;
}
