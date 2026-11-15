/**
 * Pure parsing helpers for reading a project's dependency manifests and lockfiles as plain data.
 *
 * `core/deps.ts` reads files such as `package.json`, `pyproject.toml`, `uv.lock` and `Cargo.lock`
 * and hands their text here. Each parser turns text into a plain record, or `null` when the text
 * isn't valid JSON or TOML or isn't an object, so a malformed file reads as "nothing to report"
 * instead of failing. Nothing here touches the filesystem, and nothing in a manifest is ever run.
 *
 * A major version is the part of a version a dependency report keeps: `18` for `18.3.1`, and
 * `0.7` for `0.7.9`, since under semver every `0.x` minor may break. `packageMajors` builds the
 * name-to-major map from a lockfile's package rows. Start at `packageMajors`.
 */
import { Result } from "effect";
import { parse as parseToml } from "smol-toml";

/** A non-null, non-array object as a plain record, or `null` for anything else. */
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** JSON text as a record, or `null` when it doesn't parse or isn't an object. */
export function json(text: string): Record<string, unknown> | null {
  const parsed = Result.try(() => JSON.parse(text) as unknown);
  return Result.isSuccess(parsed) ? object(parsed.success) : null;
}

/** TOML text as a record, or `null` when it doesn't parse. */
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

/** The keys of an object-valued field, such as `package.json`'s `dependencies`. */
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
 * The majors the project's own package pins, read from its row in the lockfile. A lockfile can
 * hold several versions of one package; the root row says which one the project uses directly.
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
