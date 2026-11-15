/**
 * Flags prose that will stop being true when a tool ships a new release, when `stacks validate`
 * runs.
 *
 * Entries are written once and read for years, while the tools they describe keep releasing. So
 * the product rule is that stacks hold no version literals and no dated claims: an agent picks
 * current versions when it builds the project. This check reads an entry's prose (its markdown
 * body, its `decisions` strings and every Markdown file it ships, including adapters for agents
 * not selected) and warns on two kinds of line: a dated phrase such as "as of March 2025", "rc" or
 * "nightly" (`dated-phrase`), and a pinned `x.y.z` version (`pinned-version`). Fenced code blocks
 * are skipped (`core/brief/headings.ts::proseLines`), since examples there are code, not claims.
 *
 * `core/validate/index.ts` runs `datedChecks`. `version-sensitive.ts` reuses `PINNED` to look for
 * versions in shipped config files.
 */
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { proseLines } from "../brief/headings";
import type { Entry } from "../registry/entry";
import type { EntrySources } from "./sources";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const DATED = [
  /\brc\b/i,
  /\bdist-tag\b/i,
  /\bwhile published\b/i,
  /\balpha\b/i,
  /\bnightly\b/i,
  /\bcanary\b/i,
  new RegExp(
    `\\bas of\\s+(?:(?:${MONTHS}|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\b|\\d{4}\\b)`,
    "i",
  ),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{4}\\b`),
];

/** A pinned three-part version such as `1.2.3`, not part of a longer dotted number. */
export const PINNED = /(?<![\d.])\d+\.\d+\.\d+(?![\d.])/;

/**
 * One piece of prose to scan. `offset` is added to each line number found in `text`, so a finding
 * points at the line in `file` where the text starts.
 */
type ProseSource = { text: string; offset: number; file: string };

/** Prose only: bodies, decision strings and shipped Markdown, including unselected adapters. */
export const datedChecks: Check = (view) =>
  Effect.sync(() => ({
    findings: view.entries.flatMap((entry) =>
      proseSources(view, entry).flatMap((source) => checkSource(entry, source)),
    ),
  }));

/** The body, each decision and each shipped Markdown file (`.md` or `.md.tmpl`) of an entry. */
function proseSources(view: View, entry: Entry): ProseSource[] {
  const sources = view.sources.get(entry.dir);
  const markdown = entryFile(view, entry);
  return [
    { text: entry.body, offset: sources?.bodyOffset ?? 0, file: markdown },
    ...entry.meta.decisions.map((text) => ({
      text,
      offset: decisionOffset(sources, text),
      file: markdown,
    })),
    ...(sources?.files ?? [])
      .filter((file) => /\.md(?:\.tmpl)?$/i.test(file.path))
      .map((file) => ({ text: file.text, offset: 0, file: view.file(entry, file.source) })),
  ];
}

/**
 * Where a decision string sits in the entry's markdown file: the 0-based index of the first line
 * holding its first 40 characters, or 0 when no line does. Decisions come from parsed frontmatter,
 * which keeps no line numbers, so this finds the line by its text.
 */
function decisionOffset(sources: EntrySources | undefined, text: string): number {
  return Math.max(
    0,
    sources?.text.split("\n").findIndex((line) => line.includes(text.slice(0, 40))) ?? 0,
  );
}

function checkSource(entry: Entry, source: ProseSource): Finding[] {
  return proseLines(source.text).flatMap((line) => lineFindings(entry, source, line));
}

/** One finding per pattern that matches the line, quoting the matched phrase. */
function lineFindings(
  entry: Entry,
  source: ProseSource,
  line: { text: string; line: number },
): Finding[] {
  const findings: Finding[] = [];
  for (const [check, patterns] of [
    ["dated-phrase", DATED],
    ["pinned-version", [PINNED]],
  ] as const) {
    for (const pattern of patterns) {
      const phrase = pattern.exec(line.text)?.[0];
      if (!phrase) continue;
      findings.push(
        finding(entry, {
          check,
          severity: "warning",
          file: source.file,
          line: line.line + source.offset,
          message: `${phrase} ties prose to a release; rewrite it to stay true when the tool changes`,
        }),
      );
    }
  }
  return findings;
}
