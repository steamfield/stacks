/**
 * Parses dependency manifests and lockfiles as data. Version reports retain the minor for `0.x`
 * because it can introduce breaking changes. Malformed or non-object input returns no data so
 * one unusable manifest never fails dependency reporting.
 */
import { Result } from "effect";
import { parse as parseToml } from "smol-toml";

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

export function json(text: string): Record<string, unknown> | null {
  const parsed = Result.try(() => JSON.parse(text) as unknown);
  return Result.isSuccess(parsed) ? object(parsed.success) : null;
}

export function toml(text: string): Record<string, unknown> | null {
  const parsed = Result.try(() => parseToml(text));
  return Result.isSuccess(parsed) ? object(parsed.success) : null;
}

/** A version's major (`18`), or `0.<minor>` for a `0.x` version; `null` when it isn't one. */
export function major(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const parts = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)(?=\.|[a-zA-Z+-]|$)/u.exec(version);
  if (parts === null) return null;
  return parts[1] === "0" ? `0.${parts[2]}` : (parts[1] ?? null);
}

export function names(value: unknown): ReadonlyArray<string> {
  const record = object(value);
  return record === null ? [] : Object.keys(record);
}

type Reference = { readonly name: unknown; readonly version: unknown };

/**
 * One dependency listed on the root package's lockfile row. Cargo writes it as the string
 * `"name version"`; uv writes it as a `{ name, version }` table.
 */
function referenceOf(entry: unknown): Reference {
  if (typeof entry === "string") {
    const words = entry.split(/\s+/u);
    return { name: words[0], version: words[1] };
  }
  const row = object(entry);
  return { name: row?.name, version: row?.version };
}

/**
 * Several versions of a dependency can coexist in a lockfile. The root row says which version the
 * project directly uses.
 */
function rootReferences(
  rows: ReadonlyArray<Record<string, unknown>>,
  normalize: (name: string) => string,
  rootName: string,
): Map<string, string | null> {
  const references = new Map<string, string | null>();
  const root = rows.find(
    (row) => typeof row.name === "string" && normalize(row.name) === normalize(rootName),
  );
  if (!Array.isArray(root?.dependencies)) return references;
  for (const entry of root.dependencies) {
    const { name, version } = referenceOf(entry);
    if (typeof name === "string" && typeof version === "string") {
      references.set(normalize(name), major(version));
    }
  }
  return references;
}

/**
 * Each locked package's major, keyed by normalized name, from a lockfile's `package` array. A
 * package locked at two different majors maps to `null` (unknown), unless the root package's
 * own row (`rootName`) names the one it uses, which then wins.
 */
export function packageMajors(
  value: unknown,
  normalize: (name: string) => string,
  rootName?: string,
): Map<string, string | null> {
  const majors = new Map<string, string | null>();
  if (!Array.isArray(value)) return majors;
  const rows = value.map(object).filter((row) => row !== null);
  for (const row of rows) {
    if (typeof row.name !== "string" || typeof row.version !== "string") continue;
    const name = normalize(row.name);
    const found = major(row.version);
    if (!majors.has(name)) majors.set(name, found);
    else if (majors.get(name) !== found) majors.set(name, null);
  }
  if (rootName === undefined) return majors;
  for (const [name, version] of rootReferences(rows, normalize, rootName)) {
    majors.set(name, version);
  }
  return majors;
}
