/**
 * Collects the lines of a brief as `render.ts` and `render-add.ts` write them, then joins them
 * into the finished `Brief`.
 *
 * Each line is written as either fixed or data. Fixed lines are the CLI's own wording from
 * `text.ts` (plus the blank lines between sections); data lines come from entries or the
 * composition (entry bodies, table rows, file paths). The split exists for the word budgets in
 * `core/validate/budget.ts`: `fixedWords` counts the CLI's share of the brief, so an entry author
 * is measured against what their own text adds.
 */
import type { Brief } from "./types";
import { countWords } from "./words";

/** One line of the brief and whether it is the CLI's fixed wording. */
type Segment = { fixed: boolean; text: string };

/** Appends lines to a brief in order. */
export type BriefWriter = {
  /** Lines of fixed CLI wording, or blank separator lines. */
  fixed: (...lines: ReadonlyArray<string>) => void;
  /** Lines taken from entries or the composition. */
  data: (...lines: ReadonlyArray<string>) => void;
  /** One blank line between sections. */
  gap: () => void;
  /** The text so far, ending in a newline, with its word counts. */
  brief: () => Brief;
};

/** A writer for one brief. Each call to `renderBrief` makes its own. */
export function briefWriter(): BriefWriter {
  const segments: Segment[] = [];
  const append = (fixed: boolean, lines: ReadonlyArray<string>) => {
    for (const text of lines) segments.push({ fixed, text });
  };
  return {
    fixed: (...lines) => append(true, lines),
    data: (...lines) => append(false, lines),
    gap: () => append(true, [""]),
    brief: () => {
      const text = `${segments.map((segment) => segment.text).join("\n")}\n`;
      const fixedWords = segments
        .filter((segment) => segment.fixed)
        .reduce((sum, segment) => sum + countWords(segment.text), 0);
      return { text, briefWords: countWords(text), fixedWords };
    },
  };
}
