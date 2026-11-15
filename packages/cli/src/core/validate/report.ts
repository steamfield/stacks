/**
 * Turns `stacks validate` results into the text a person or an agent reads; `--json` output skips
 * this file and prints the report object as is.
 *
 * `commands/validate.ts` calls `renderReport` for a registry check, and the three `renderPreview*`
 * functions for `validate --brief`. Text differs by audience (`human` or `agent`, see
 * `services/output.ts`) only in which size rows it shows; every finding is printed either way.
 * Every value that came from an entry goes through `printable`, so a name or message holding
 * terminal escape sequences can't restyle or rewrite the terminal.
 */
import type { BriefPreview, Finding, SizeRow, ValidateReport } from "../../schemas/validate";
import type { Audience } from "../../services/output";
import { printable } from "../text";

/** A number with thousands separators, as every count in the report prints. */
const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A path or id as one shell word: as is when it is plain, single-quoted otherwise. */
function shellWord(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * The label of a size row: `go-cli body`, `go-cli (sandbox) + postgres`, `effect shipped`. An id
 * both a stack and a fragment use gets its kind (`twin (fragment) body`).
 */
function sizeLabel(row: SizeRow, shared: ReadonlySet<string>): string {
  if (row.kind !== "composed") {
    const kind = shared.has(row.entry) ? ` (${row.entryKind})` : "";
    return `${printable(row.entry)}${kind} ${row.kind}`;
  }
  const added = row.with === undefined ? "" : ` + ${printable(row.with)}`;
  return `${printable(row.entry)} (${row.preset})${added}`;
}

/** One finding as an indented row, with the check ids padded to line up. */
function findingLine(finding: Finding, checkWidth: number): string {
  const where = finding.file
    ? `${printable(finding.file)}${finding.line === undefined ? "" : `:${finding.line}`}: `
    : "";
  return `  ${finding.severity.padEnd(7)}  ${finding.check.padEnd(checkWidth)}  ${where}${printable(finding.message)}`;
}

/** Findings grouped under a heading per entry (`stack go-cli`), or `registry` for the root. */
function renderFindings(findings: ReadonlyArray<Finding>): string[] {
  const checkWidth = Math.max(0, ...findings.map((finding) => finding.check.length));
  const out: string[] = [];
  let group: string | undefined;
  for (const finding of findings) {
    const heading =
      finding.entry === undefined ? "registry" : `${finding.kind} ${printable(finding.entry)}`;
    if (heading !== group) out.push("", heading);
    group = heading;
    out.push(findingLine(finding, checkWidth));
  }
  return out;
}

const over = (row: SizeRow) => row.limit !== undefined && row.words > row.limit;

/** The ids both a stack and a fragment use, whose size labels must name their kind. */
function sharedIds(rows: ReadonlyArray<SizeRow>): ReadonlySet<string> {
  const ids = (kind: SizeRow["entryKind"]) =>
    new Set(rows.filter((row) => row.entryKind === kind).map((row) => row.entry));
  const fragments = ids("fragment");
  return new Set([...ids("stack")].filter((id) => fragments.has(id)));
}

/** The size table: `sizes` are the rows to show, `allSizes` every row the report holds. */
function renderSizes(sizes: ReadonlyArray<SizeRow>, allSizes: ReadonlyArray<SizeRow>): string[] {
  if (!sizes.length) return [];
  // Labels disambiguate against every row, shown or not, so a label never depends on audience.
  const shared = sharedIds(allSizes);
  const label = (row: SizeRow) => sizeLabel(row, shared);
  const width = Math.max(...sizes.map((row) => label(row).length));
  const numbers = Math.max(...sizes.map((row) => n(row.words).length));
  const rows = sizes.map((row) => {
    const limit = row.limit === undefined ? "" : ` / ${n(row.limit)}`;
    const fixed = row.fixedWords === undefined ? "" : `   fixed ${n(row.fixedWords)}`;
    return `  ${label(row).padEnd(width)}  ${n(row.words).padStart(numbers)}${limit}${fixed}${over(row) ? "   over" : ""}`;
  });
  return ["", "Sizes (words)", ...rows];
}

type ReportOptions = {
  invocation: string;
  path: string | undefined;
  firstStack: string | undefined;
  audience: Audience;
  root: string;
  /** `validate --submission`: the next step is the same check, or a dry-run submit. */
  submission?: boolean;
};

/**
 * The `Next:` line: fix and rerun when there are errors; otherwise a dry-run submit after
 * `--submission`, or a brief preview of the first stack. No line when there is nothing to suggest.
 */
function nextLine(errors: number, options: ReportOptions): string | undefined {
  const target = options.path === undefined ? "" : ` ${shellWord(printable(options.path))}`;
  const submission = options.submission ? " --submission" : "";
  if (errors)
    return `Next: fix the errors above, then run ${options.invocation} validate${target}${submission}`;
  if (options.submission) return `Next: ${options.invocation} submit${target} --dry-run`;
  if (options.firstStack !== undefined)
    return `Next: ${options.invocation} validate${target} --brief ${shellWord(options.firstStack)} --sandbox`;
  return undefined;
}

/**
 * The text report: a header, findings grouped by entry, the size table, a total line, and a
 * `Next:` line. A human gets every size; an agent only the rows over their limit, and the root as
 * `root` (the command passes it relative to the working directory when it can be). Every value
 * from an entry goes through `printable`.
 */
export function renderReport(report: ValidateReport, options: ReportOptions): string {
  const { stacks, fragments } = report.entries;
  const counted = `${plural(stacks, "stack")}, ${plural(fragments, "fragment")}`;
  const sizes = options.audience === "human" ? report.sizes : report.sizes.filter(over);
  const tally = (severity: Finding["severity"]) =>
    report.findings.filter((finding) => finding.severity === severity).length;
  const errors = tally("error");
  const next = nextLine(errors, options);
  return [
    `Validated ${printable(options.root)}${report.bundled ? " (bundled registry)" : ""}`,
    ...renderFindings(report.findings),
    ...renderSizes(sizes, report.sizes),
    "",
    `${counted}: ${plural(errors, "error")}, ${plural(tally("warning"), "warning")}, ${plural(tally("note"), "note")}`,
    ...(next === undefined ? [] : [next]),
  ].join("\n");
}

/** `validate --brief` size report for human stderr. */
export function renderPreview(preview: BriefPreview): string {
  const over = preview.briefWords > preview.limit;
  const summary = [
    `Brief: ${n(preview.briefWords)} words (fixed text ${n(preview.fixedWords)}), limit ${n(preview.limit)}${over ? `, over by ${n(preview.briefWords - preview.limit)}` : ""}`,
    `Stack: ${printable(preview.stack)} (${preview.preset})`,
    `Fragments: ${preview.fragments.length ? preview.fragments.map(printable).join(", ") : "none"}`,
    ...preview.warnings.map(
      (warning) => `Warning: ${warning.code.replaceAll("_", " ")}: ${printable(warning.id)}`,
    ),
  ];
  return `\n---\n${summary.join("\n")}`;
}

/** Entry prose is lossless in JSON; text preserves lines and tabs while escaping terminal controls. */
export const renderPreviewBrief = (preview: BriefPreview): string =>
  preview.brief
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t").map(printable).join("\t"))
    .join("\n");

/** Actionable preview failures without appending anything to the brief on stdout. */
export function renderPreviewErrors(preview: BriefPreview): string {
  const errors = preview.findings.filter((finding) => finding.severity === "error");
  const width = Math.max(0, ...errors.map((finding) => finding.check.length));
  return [
    ...errors.map((finding) => findingLine(finding, width)),
    "Next: fix the reported entries, then rerun this preview.",
  ].join("\n");
}
