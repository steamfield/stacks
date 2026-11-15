/**
 * Turns a value into one exact JSON string, so the same data always hashes to the same digest.
 *
 * Plain `JSON.stringify` writes object keys in insertion order, so two equal objects built in a
 * different order would hash differently. Every persisted digest goes through this function: the
 * manifest's tamper digests (`manifest.ts::digestSteps`), composition fingerprints
 * (`fingerprint.ts`) and search digests (`search/digest.ts`). Its output is pinned by
 * `tests/digest-golden.test.ts`; changing a single byte would make every existing project's
 * manifest look tampered with.
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
