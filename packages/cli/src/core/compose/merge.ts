/** Deep-merges JSON for shared composition files and parked add conflicts. */

/**
 * Merge objects recursively and concatenate arrays with duplicates removed by value. For other
 * values, the later one wins. Merged objects have no prototype so `__proto__` stays an ordinary key.
 */
export function deepMerge(earlier: unknown, later: unknown): unknown {
  if (Array.isArray(earlier) && Array.isArray(later)) {
    const seen = new Set<string>();
    return [...earlier, ...later].filter((item) => {
      const key = canonical(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (isObject(earlier) && isObject(later)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(earlier)) out[key] = value;
    for (const [key, value] of Object.entries(later))
      out[key] = Object.hasOwn(out, key) ? deepMerge(out[key], value) : value;
    return out;
  }
  return later;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON value's text with object keys sorted, so equal values compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
