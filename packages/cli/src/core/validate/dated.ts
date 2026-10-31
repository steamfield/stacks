import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { proseLines } from "../brief/headings";
import type { Entry } from "../registry/entry";
import { type Check, entryFile, finding } from "./view";

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
export const PINNED = /(?<![\d.])\d+\.\d+\.\d+(?![\d.])/;

/** Prose only: bodies, decision strings and shipped Markdown, including unselected adapters. */
export const datedChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    for (const entry of view.entries) {
      const sources = view.sources.get(entry.dir);
      const texts = [
        { text: entry.body, offset: sources?.bodyOffset ?? 0, file: entryFile(view, entry) },
        ...entry.meta.decisions.map((text) => ({
          text,
          offset: Math.max(
            0,
            sources?.text.split("\n").findIndex((line) => line.includes(text.slice(0, 40))) ?? 0,
          ),
          file: entryFile(view, entry),
        })),
        ...(sources?.files ?? [])
          .filter((file) => /\.md(?:\.tmpl)?$/i.test(file.path))
          .map((file) => ({ text: file.text, offset: 0, file: view.file(entry, file.source) })),
      ];
      for (const source of texts) findings.push(...checkSource(entry, source));
    }
    return { findings };
  });
function checkSource(
  entry: Entry,
  source: { text: string; offset: number; file: string },
): Finding[] {
  const findings: Finding[] = [];
  for (const line of proseLines(source.text)) {
    findings.push(...lineFindings(entry, source, line));
  }
  return findings;
}

function lineFindings(
  entry: Entry,
  source: { file: string; offset: number },
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
