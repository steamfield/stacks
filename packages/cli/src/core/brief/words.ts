/**
 * Counts words consistently for reports and budgets. Conditional markers are syntax and excluded by
 * `isConditionalMarker`.
 */
import { isConditionalMarker } from "../compose/conditionals";

/** Count non-whitespace runs, including fenced code, after excluding conditional marker lines. */
export function countWords(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (isConditionalMarker(line)) continue;
    for (const word of line.split(/\s+/)) if (word) count++;
  }
  return count;
}
