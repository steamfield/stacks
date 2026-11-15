/**
 * The CLI's one word counter. The word budgets on briefs, entry bodies and search copy are all
 * measured with it, so `core/validate/`, `show` and the brief's own counts agree.
 *
 * A conditional marker line (`<!-- stacks:when ... -->` or `<!-- stacks:end -->`, see
 * `core/compose/conditionals.ts`) is composition syntax rather than text an agent reads, so it
 * never counts.
 */
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
