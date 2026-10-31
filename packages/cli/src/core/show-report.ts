import type { ShowReport } from "../schemas/show";
import { plainStyle, type Style } from "../services/output";
import { statsFields, statsLine } from "./stats-text";
import { printable } from "./text";
import { BUDGET } from "./validate/budget";
import { wrap, wrapWords } from "./wrap";

const safeLine = (line: string) => line.split("\t").map(printable).join("\t");

function lastRunLine(lastRun: ShowReport["lastRun"]): string {
  if (!lastRun) return "Last run: none";
  return `Last run: ${lastRun.result} ${lastRun.date}${lastRun.stack ? ` on ${lastRun.stack}` : ""}, ${lastRun.sameContent ? "same content" : "changed content"}`;
}

function statsLines(stats: ShowReport["stats"]): string[] {
  if (!stats?.published) return [];
  const lines = [statsLine(statsFields(stats, stats))];
  if (stats.kind !== "stack") return lines;
  const steps = Object.entries(stats.stepFailureShares)
    .flatMap(([name, share]) => (share.suppressed ? [] : [{ name, value: share.value }]))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, 3);
  if (steps.length)
    lines.push(
      "Steps failing before first green:",
      ...steps.map(({ name, value }) => `  ${name} ${Math.round(value * 100)}%`),
    );
  const start = new Date(Date.parse(`${stats.through}T00:00:00Z`) - (stats.window - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const latest = stats.series
    .flatMap((point) => point.changes.map((change) => change.day))
    .sort()
    .at(-1);
  if (latest && latest > start) lines.push(`content changed ${latest}`);
  return lines;
}

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

function dependencyLines(report: ShowReport, human: boolean): string[] {
  const list = (values: ReadonlyArray<string>) => (values.length ? values.join(", ") : "none");
  return Object.entries(report.deps).flatMap(([role, names]) => {
    if (role !== "app" || !human || names.length === 0)
      return [`Dependencies (${role}): ${list(names)}`];
    return [
      "Dependencies (app):",
      ...names.map((name) => {
        const matches = Object.entries(report.dependencyCards ?? {}).filter(
          ([key]) => key.slice(key.indexOf("/") + 1) === name,
        );
        const card = matches.length === 1 ? matches[0]?.[1] : undefined;
        return `  ${name}${card ? `: ${card.whatItIs}` : ""}`;
      }),
    ];
  });
}

/** Complete text review, including commands and every unfiltered guidance branch. */
export function renderShow(
  report: ShowReport,
  invocation: string,
  layout?: { width: number; measure: (text: string) => number },
  style: Style = plainStyle,
): string {
  const list = (values: ReadonlyArray<string>) => (values.length ? values.join(", ") : "none");
  const out = [
    `${report.name} (${report.id}), ${report.kind}, origin ${report.origin}, ${report.trusted ? "trusted" : "untrusted"}`,
    ...plainLines(report.plain).flatMap((line) =>
      layout ? wrapWords(line, layout.width, layout.measure).split("\n") : [line],
    ),
    report.description,
    ...(report.author === undefined ? [] : [`Author: @${report.author}`]),
    `Path: ${report.path}`,
    `Shadows: ${list(report.shadows)}`,
    `Tags: ${list(report.tags)}`,
    ...dependencyLines(report, layout !== undefined),
    `Tools: ${list(report.tools)}`,
    ...(report.decisions.length
      ? ["Decisions:", ...report.decisions.map((decision) => `  - ${decision}`)]
      : ["Decisions: none"]),
    ...Object.entries(report.env).map(([key, value]) => `Environment: ${key}=${value}`),
    ...Object.entries(report.commands).map(([key, value]) => `Command: ${key}: ${value}`),
  ];
  if (report.fragments)
    out.push(
      `Fragments: required ${list(report.fragments.required)}; default ${list(report.fragments.default)}; optional ${list(report.fragments.optional)}`,
    );
  if (report.category)
    out.push(
      `Category: ${report.category}`,
      `Applies to: ${list(report.appliesTo ?? [])}`,
      `Fits: ${list(report.fits ?? [])}`,
      `Requires: ${list(report.requires ?? [])}`,
      `Conflicts: ${list(report.conflicts ?? [])}`,
      `Requires tools: ${list(report.requiresTools ?? [])}`,
      `Needs own repository: ${report.needsOwnRepo ? "yes" : "no"}`,
    );
  out.push(
    "Verify:",
    ...report.verify.map((step) => {
      // Everything but the name and command, e.g. `phase setup, layer install`.
      const { name, run, ...rest } = step;
      const extra = Object.entries(rest).map(
        ([key, value]) => `${key} ${typeof value === "string" ? value : JSON.stringify(value)}`,
      );
      return `  ${name}: ${run}${extra.length ? ` (${extra.join(", ")})` : ""}`;
    }),
  );
  out.push(
    "Files:",
    ...(report.files.length
      ? report.files.map(
          (file) => `  ${file.path}${file.agent ? ` (${file.agent})` : ""} <- ${file.source}`,
        )
      : ["  none"]),
  );
  out.push(
    `Body: ${report.bodyWords.toLocaleString("en-US")} words (cap ${report.bodyCap.toLocaleString("en-US")})`,
  );
  if (report.briefWords !== null)
    out.push(
      `Brief: ${report.briefWords.toLocaleString("en-US")} words with defaults (cap ${report.briefCap.toLocaleString("en-US")}; ${BUDGET.composedWithApp.toLocaleString("en-US")} with an app)`,
    );
  out.push(lastRunLine(report.lastRun));
  out.push(
    ...statsLines(report.stats).flatMap((line) =>
      layout && line.startsWith("Stats:")
        ? wrapWords(line, layout.width, layout.measure).split("\n")
        : [line],
    ),
  );
  out.push(
    "",
    "--- guidance ---",
    ...(layout
      ? wrap(
          report.body.trimEnd().split("\n").map(safeLine).join("\n"),
          layout.width,
          layout.measure,
        )
      : report.body.trimEnd()
    ).split("\n"),
    "",
    nextLine(report, invocation),
  );
  return out
    .map((line) => {
      const safe = safeLine(line);
      return safe.startsWith("Next:") ? style("next", safe) : safe;
    })
    .join("\n");
}

function nextLine(report: ShowReport, invocation: string): string {
  if (report.kind === "fragment") return `Next: ${invocation} new <stack> --with ${report.id}`;
  if (report.origin === "index")
    return `Next: ${invocation} new ${report.id} --dry-run --sandbox --no-launch`;
  return `Next: ${invocation} validate --brief ${report.id} --sandbox`;
}
