import { isConditionalMarker } from "../compose/conditionals";

/**
 * Words in `text`: runs of non-whitespace, after removing conditional marker lines. Code fences
 * and their content count. The one word counter.
 */
export function countWords(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (isConditionalMarker(line)) continue;
    for (const word of line.split(/\s+/)) if (word) count++;
  }
  return count;
}
