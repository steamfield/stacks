/**
 * Canonicalizes JSON for persisted digests. Sorting keys makes the bytes independent of insertion
 * order, and changing those bytes invalidates existing digests.
 */

/** Orders keys by UTF-16 code units, the same order `Array.prototype.sort` gives strings. */
function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * JSON with object keys sorted at every level and arrays kept in order; `undefined` values are
 * dropped the way `JSON.stringify` drops them.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(byKey);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
