/**
 * Writes the text `stacks list` prints, in its two views.
 *
 * `renderList` is the catalog: one section each for stacks, fragments and apps, a block of rejected
 * entries (ones that failed to load, with the reason), then `Next:` lines suggesting a command to
 * try. `renderAddable` is the view inside a project: the fragments it can still add, each with the
 * `stacks add` command that applies it. `commands/list.ts` picks the view and builds the rows with
 * `list.ts`; `--json` prints the result itself and never comes here.
 *
 * Descriptions and stats wrap to `width`. `commands/list.ts` passes the terminal's width (at most
 * 80 columns) for a person and an unlimited one for an agent, so an agent gets each description on one line. Every
 * field that comes from an entry goes through `printable` (`text.ts`), so a crafted name or
 * description can't steer the terminal with escape codes.
 */
import type { ListResult, ListRow } from "../schemas/list";
import { plainStyle, type Style } from "../services/output";
import { type Group, inGroup } from "./list";
import { statsLine } from "./stats-text";
import { printable } from "./text";
import { wrapWords } from "./wrap";

type Measure = (text: string) => number;

const INDENT = "    ";

const sections = [
  { title: "Stacks", group: "stacks" },
  { title: "Fragments", group: "fragments" },
  { title: "Apps", group: "apps" },
] as const;

/** `text` wrapped to `width` (indent included) and indented under its row. */
function indentedLines(text: string, width: number, measure: Measure): string[] {
  return wrapWords(text, width - measure(INDENT), measure)
    .split("\n")
    .map((line) => `${INDENT}${line}`);
}

/**
 * A row's description under it. Whitespace (newlines included) folds to single spaces before
 * escaping, as wrapping would; an empty description prints nothing.
 */
function descriptionLines(
  description: string,
  width: number,
  measure: Measure = (text) => text.length,
): string[] {
  const text = printable(description.replace(/\s+/g, " ")).trim();
  if (!text) return [];
  return indentedLines(text, width, measure);
}

/** A row's `Stats:` line under it, when the row has published stats. */
function statsLines(
  stats: ListRow["stats"],
  width: number,
  measure: Measure = (text) => text.length,
): string[] {
  if (!stats) return [];
  return indentedLines(statsLine(stats), width, measure);
}

/** An app's host stacks (`on a, b`), or a fragment's category. */
function categoryFields(row: ListRow): string[] {
  if (row.category === "app") return [`on ${printable((row.appliesTo ?? []).join(", "))}`];
  return row.category ? [row.category] : [];
}

/**
 * A stack's last recorded run, or `unproven`. Shown only when there is a bundled ledger to read
 * runs from, or for an index stack, whose proof comes with the index.
 */
function ledgerFields(row: ListRow, ledgerPresent: boolean | undefined, style: Style): string[] {
  if ((!ledgerPresent && row.origin !== "index") || row.kind !== "stack") return [];
  if (!row.lastRun) return [style("dim", "unproven")];
  const result = row.lastRun.result === "pass" ? "historical pass" : row.lastRun.result;
  return [
    `${style(row.lastRun.result === "pass" ? "ok" : "warn", result)} ${printable(row.lastRun.date)}`,
  ];
}

/** How every row in one rendering lays out its columns. */
type RowLayout = {
  idWidth: number;
  /** Set only when the rows come from more than one origin; otherwise the column is left out. */
  originWidth: number | undefined;
  ledgerPresent: boolean | undefined;
  style: Style;
};

/** One row's columns, two spaces apart: id, origin, category, last run, trust, shadows. */
function rowLine(row: ListRow, layout: RowLayout): string {
  const { originWidth } = layout;
  return [
    printable(row.id).padEnd(layout.idWidth),
    ...(originWidth === undefined ? [] : [row.origin.padEnd(originWidth)]),
    ...categoryFields(row),
    ...ledgerFields(row, layout.ledgerPresent, layout.style),
    ...(row.trusted ? [] : ["untrusted"]),
    ...(row.shadows.length ? [`shadows ${row.shadows.join(", ")}`] : []),
  ]
    .join("  ")
    .trimEnd();
}

/**
 * The human view: one section per group with rows, a Rejected block, then `Next:` lines. `all`
 * is every row in the registry (not only this group), which picks the stack `Next:` names. Every
 * field from an entry goes through `printable`, so no file can steer the terminal.
 */
export function renderList(
  result: ListResult,
  all: ReadonlyArray<ListRow>,
  options: {
    group: Group | undefined;
    width: number;
    invocation: string;
    ledgerPresent?: boolean;
    measure?: (text: string) => number;
    style?: Style;
  },
): string {
  const { width, invocation, measure } = options;
  const style = options.style ?? plainStyle;
  const rows = result.entries;
  const multipleOrigins = new Set(rows.map((row) => row.origin)).size > 1;
  const originWidth = Math.max(0, ...rows.map((row) => row.origin.length));
  const out: string[] = [];
  for (const section of sections) {
    const members = rows.filter((row) => inGroup(row, section.group));
    if (!members.length) continue;
    if (out.length) out.push("");
    out.push(section.title);
    const layout: RowLayout = {
      idWidth: Math.max(...members.map((row) => printable(row.id).length)),
      originWidth: multipleOrigins ? originWidth : undefined,
      ledgerPresent: options.ledgerPresent,
      style,
    };
    for (const row of members)
      out.push(
        `  ${rowLine(row, layout)}`,
        ...statsLines(row.stats, width, measure),
        ...descriptionLines(row.description, width, measure),
      );
  }
  if (!rows.length) out.push(`No ${options.group ?? "stacks or fragments"} found.`);
  out.push(...rejectedLines(result.rejected));
  out.push(
    "",
    ...nextLines(all, result.rejected.length > 0, options.group, invocation).map((line) =>
      style("next", line),
    ),
  );
  return out.join("\n");
}

/**
 * The catalog's `Next:` lines. Only a trusted stack or app is ever suggested; an untrusted one is
 * for the reader to judge. With no stacks at all, the hint points at the likely cause instead.
 */
function nextLines(
  all: ReadonlyArray<ListRow>,
  rejected: boolean,
  group: Group | undefined,
  invocation: string,
) {
  const stacks = all.filter((row) => row.kind === "stack");
  // No stacks: a rejected entry is the likelier cause; otherwise the registry path is wrong.
  if (!stacks.length)
    return [
      rejected
        ? `Next: fix or remove the rejected entries above, then run ${invocation} list`
        : `Next: ${invocation} doctor`,
    ];
  const trusted = stacks.filter((row) => row.trusted);
  const stack = trusted[0];
  if (!stack) return [`Next: ${invocation} list --json`];
  const app = group === "apps" ? suggestedApp(all, trusted) : undefined;
  return [
    app
      ? `Next: ${invocation} new ${app.on} my-project --with ${app.id} --sandbox`
      : `Next: ${invocation} new ${stack.id} my-project --sandbox`,
    `Next: ${invocation} list --json`,
  ];
}

/** The first trusted app with a trusted host stack, paired with its first such stack. */
function suggestedApp(all: ReadonlyArray<ListRow>, trustedStacks: ReadonlyArray<ListRow>) {
  const ids = new Set(trustedStacks.map((row) => row.id));
  return all
    .filter((row) => row.category === "app" && row.trusted)
    .flatMap((row) =>
      (row.appliesTo ?? []).filter((id) => ids.has(id)).map((on) => ({ id: row.id, on })),
    )[0];
}

type AddableContext = {
  addable: ReadonlyArray<ListRow>;
  rejected: ListResult["rejected"];
  width: number;
  invocation: string;
  /** ` --dir <path>` to repeat in each hint, or empty without `--dir`. */
  dirFlag: string;
  measure?: (text: string) => number;
  style?: Style;
};

/** The in-project view: each fragment the project can add, with the command that adds it. */
export function renderAddable({
  addable,
  rejected,
  width,
  invocation,
  dirFlag,
  measure,
  style = plainStyle,
}: AddableContext): string {
  return [
    "Fragments you can add",
    ...addable.flatMap((row) => [
      `  ${printable(row.id)}${row.trusted ? "" : "  untrusted"}`,
      ...statsLines(row.stats, width, measure),
      ...descriptionLines(row.description, width, measure),
      `    ${style("next", `Next: ${invocation} add ${row.id}${dirFlag}`)}`,
    ]),
    ...rejectedLines(rejected),
    "",
    style("next", `Next: ${invocation} list stacks${dirFlag}`),
  ].join("\n");
}

/** Entries that failed to load, each with its reason and directory. */
function rejectedLines(rejected: ListResult["rejected"]): string[] {
  if (!rejected.length) return [];
  return [
    "",
    "Rejected",
    // The directory goes on its own line, whole, so it can be copied.
    ...rejected.flatMap((entry) => [
      `  ${entry.kind} ${printable(entry.id)} (${entry.origin}): ${printable(entry.error)}`,
      `    ${printable(entry.dir)}`,
    ]),
  ];
}
