import type { BriefPreview, Finding, SizeRow, ValidateReport } from "../../schemas/validate";
import type { Audience } from "../../services/output";
import { printable } from "../text";

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

function findingLine(finding: Finding, checkWidth: number): string {
  const where = finding.file
    ? `${printable(finding.file)}${finding.line === undefined ? "" : `:${finding.line}`}: `
    : "";
  return `  ${finding.severity.padEnd(7)}  ${finding.check.padEnd(checkWidth)}  ${where}${printable(finding.message)}`;
}

const over = (row: SizeRow) => row.limit !== undefined && row.words > row.limit;

function renderSizes(sizes: ReadonlyArray<SizeRow>, allSizes: ReadonlyArray<SizeRow>): string[] {
  if (!sizes.length) return [];
  const out: string[] = [];
  out.push("", "Sizes (words)");
  // Labels disambiguate against every row, shown or not, so a label never depends on audience.
  const ids = (kind: SizeRow["entryKind"]) =>
    new Set(allSizes.filter((row) => row.entryKind === kind).map((row) => row.entry));
  const fragments = ids("fragment");
  const shared = new Set([...ids("stack")].filter((id) => fragments.has(id)));
  const label = (row: SizeRow) => sizeLabel(row, shared);
  const width = Math.max(...sizes.map((row) => label(row).length));
  const numbers = Math.max(...sizes.map((row) => n(row.words).length));
  for (const row of sizes) {
    const limit = row.limit === undefined ? "" : ` / ${n(row.limit)}`;
    const fixed = row.fixedWords === undefined ? "" : `   fixed ${n(row.fixedWords)}`;
    out.push(
      `  ${label(row).padEnd(width)}  ${n(row.words).padStart(numbers)}${limit}${fixed}${over(row) ? "   over" : ""}`,
    );
  }
  return out;
}

/**
 * The text report: a header, findings grouped by entry, the size table, a total line, and a
 * `Next:` line. A human gets every size; an agent only the rows over their limit, and the root as
 * `root` (the command passes it relative to the working directory when it can be). Every value
 * from an entry goes through `printable`.
 */
export function renderReport(
  report: ValidateReport,
  options: {
    invocation: string;
    path: string | undefined;
    firstStack: string | undefined;
    audience: Audience;
    root: string;
    /** `validate --submission`: the next step is the same check, or a dry-run submit. */
    submission?: boolean;
  },
): string {
  const { stacks, fragments } = report.entries;
  const counted = `${plural(stacks, "stack")}, ${plural(fragments, "fragment")}`;
  const out = [
    `Validated ${printable(options.root)}${report.bundled ? " (bundled registry)" : ""}: ${counted}`,
  ];
  const sizes = options.audience === "human" ? report.sizes : report.sizes.filter(over);
  const checkWidth = Math.max(0, ...report.findings.map((finding) => finding.check.length));
  let group: string | undefined;
  for (const finding of report.findings) {
    const heading =
      finding.entry === undefined ? "registry" : `${finding.kind} ${printable(finding.entry)}`;
    if (heading !== group) out.push("", heading);
    group = heading;
    out.push(findingLine(finding, checkWidth));
  }
  out.push(...renderSizes(sizes, report.sizes));
  const tally = (severity: Finding["severity"]) =>
    report.findings.filter((finding) => finding.severity === severity).length;
  const errors = tally("error");
  out.push(
    "",
    `${counted}: ${plural(errors, "error")}, ${plural(tally("warning"), "warning")}, ${plural(tally("note"), "note")}`,
  );
  const target = options.path === undefined ? "" : ` ${shellWord(printable(options.path))}`;
  const submission = options.submission ? " --submission" : "";
  if (errors)
    out.push(
      `Next: fix the errors above, then run ${options.invocation} validate${target}${submission}`,
    );
  else if (options.submission) out.push(`Next: ${options.invocation} submit${target} --dry-run`);
  else if (options.firstStack !== undefined)
    out.push(
      `Next: ${options.invocation} validate${target} --brief ${shellWord(options.firstStack)} --sandbox`,
    );
  return out.join("\n");
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
