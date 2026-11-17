/**
 * Accumulates a brief and counts its fixed and total words. The fixed count lets entry authors see
 * how much of the budget their own text uses.
 */
import type { Brief } from "./types";
import { countWords } from "./words";

type Segment = { fixed: boolean; text: string };

export type BriefWriter = {
  /** Lines of fixed CLI wording, or blank separator lines. */
  fixed: (...lines: ReadonlyArray<string>) => void;
  /** Lines taken from entries or the composition. */
  data: (...lines: ReadonlyArray<string>) => void;
  gap: () => void;
  /** The text so far, ending in a newline, with its word counts. */
  brief: () => Brief;
};

/** Keep fixed and data lines in append order while tracking which words count toward each budget. */
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
