/**
 * Warns, during `stacks validate`, about underlined (setext) headings in an entry's body.
 *
 * Markdown has two heading styles: `## Title` (ATX) and a line of text underlined with `===` or
 * `---` (setext). When the CLI writes the brief it nests each entry's ATX headings under its own
 * sections (`core/brief/headings.ts`), but it can't shift a setext heading's level, so one would
 * stand out of place in the brief. `index.ts` runs `headingChecks`; fenced code examples are
 * skipped because `proseLines` leaves them out.
 */
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { proseLines } from "../brief/headings";
import type { Check } from "./types";
import { entryFile, finding } from "./view";

type ProseLine = ReturnType<typeof proseLines>[number];

/**
 * Whether `line` underlines `previous` as a setext heading: directly below it, a run of `=` or
 * `-`, under a line of text that isn't already a heading, quote, list item or comment.
 */
function isSetextUnderline(previous: ProseLine, line: ProseLine): boolean {
  return (
    previous.line + 1 === line.line &&
    previous.text.trim() !== "" &&
    !/^\s*(?:#|>|[-*+]\s|<!--)/.test(previous.text) &&
    /^ {0,3}(?:=+|-+)\s*$/.test(line.text)
  );
}

export const headingChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    for (const entry of view.entries) {
      const lines = proseLines(entry.body);
      for (let index = 1; index < lines.length; index++) {
        const line = lines[index];
        const previous = lines[index - 1];
        if (!line || !previous || !isSetextUnderline(previous, line)) continue;
        findings.push(
          finding(entry, {
            check: "setext-heading",
            severity: "warning",
            file: entryFile(view, entry),
            line: previous.line + (view.sources.get(entry.dir)?.bodyOffset ?? 0),
            message: `underlined heading ${previous.text.trim()} keeps its own level in the brief; use an ATX heading`,
          }),
        );
      }
    }
    return { findings };
  });
