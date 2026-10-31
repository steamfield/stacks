/**
 * Splits text into words: accents are dropped (é becomes e), and anything that isn't a letter or
 * a digit separates words. Internal: src/index.ts never re-exports from src/internal/.
 */
export function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/**
 * Joins words with `separator`, stopping before the slug passes `maxLength`. A first word longer
 * than the limit is cut, so the result is never empty when there is at least one word.
 */
export function joinWithin(list: readonly string[], separator: string, maxLength: number): string {
  let slug = "";
  for (const word of list) {
    const next = slug ? `${slug}${separator}${word}` : word;
    if (next.length > maxLength) return slug || word.slice(0, maxLength);
    slug = next;
  }
  return slug;
}
