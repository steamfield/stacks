/**
 * Owns decoded entries and their file selection through `shippedPath`. Decode problems are
 * user-visible text.
 */
import {
  FragmentMeta,
  type IndexEntry,
  type Kind,
  StackMeta,
  shippedPath,
} from "@steamfield/stacks-format";
import { Effect, Result, Schema, SchemaIssue } from "effect";
import { parseDocument } from "yaml";
import type { Origin } from "../../schemas/origin";

export type { Origin } from "../../schemas/origin";

export type Entry = {
  /** A loaded entry carries only its data. */
  _tag?: undefined;
  id: string;
  kind: Kind;
  origin: Origin;
  /** Absolute. */
  dir: string;
  trusted: boolean;
  /** Lower origins that hold an entry of the same kind and id. */
  shadows: ReadonlyArray<Origin>;
  meta: StackMeta | FragmentMeta;
  body: string;
  /** Index proof and the exact default fragment snapshot, including bundled fallback. */
  indexEntry?: IndexEntry;
  composition?: ReadonlyArray<Entry>;
};
/** Names and tags used for selection without downloading unrelated entry bundles. */
export type CatalogEntry = Pick<Entry, "id" | "kind" | "origin"> & {
  tags: ReadonlyArray<string>;
  rejected: boolean;
};
/** The kind and id identify an entry even when a stack and fragment share an id. */
export const entryRef = (entry: Entry) => ({ kind: entry.kind, id: entry.id });

export type RejectedEntry = {
  _tag: "Rejected";
  id: string;
  kind: Kind;
  origin: Origin;
  dir: string;
  error: string;
  reason: "decode" | "symlink" | "id_mismatch" | "missing" | "unreadable";
  path?: string;
};
export type RegistryEntry = Entry | RejectedEntry;
export type Stack = Entry & { meta: StackMeta };
export type Fragment = Entry & { meta: FragmentMeta };

export const entryKey = (kind: Kind, id: string) => `${kind}/${id}`;

export function compareEntries(
  a: Pick<Entry, "id" | "kind">,
  b: Pick<Entry, "id" | "kind">,
): number {
  if (a.kind !== b.kind) return a.kind === "stack" ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function catalogRow(entry: RegistryEntry): CatalogEntry {
  const rejected = isRejected(entry);
  return {
    id: entry.id,
    kind: entry.kind,
    origin: entry.origin,
    tags: rejected ? [] : entry.meta.tags,
    rejected,
  };
}
/**
 * A file an entry ships. `source` is the entry-relative path on disk; `path` is where it goes in
 * the project: `source` without its files, agent adapter or stack overlay prefix. Names are literal.
 */
export type EntryFile = { source: string; path: string; mode: number };

/**
 * A stack's payload variants: `payloads/example/` holds the example the stack ships by default,
 * `payloads/none/` the empty variant `new --payload none` writes instead.
 */
export const PAYLOADS = ["example", "none"] as const;
export type Payload = (typeof PAYLOADS)[number];
export const DEFAULT_PAYLOAD: Payload = "example";

export function shippedOnlyFor(source: string, kind: "agent" | "stack", id: string): boolean {
  const condition = shippedPath(source)?.condition;
  return condition?.kind === kind && condition.id === id;
}

/** Apply the target agents, host stack and payload to the mapping from `shippedPath`. */
export function shipsFor(
  source: string,
  agents: ReadonlyArray<string>,
  stack: string | null,
  payload: Payload = DEFAULT_PAYLOAD,
): boolean {
  const condition = shippedPath(source)?.condition;
  if (!condition) return true;
  if (condition.kind === "agent") return agents.includes(condition.id);
  if (condition.kind === "payload") return condition.id === payload;
  return condition.id === stack;
}

export function isRejected(value: RegistryEntry): value is RejectedEntry {
  return value._tag === "Rejected";
}
export function isStack(value: RegistryEntry): value is Stack {
  return !isRejected(value) && value.meta.kind === "stack";
}
export function isFragment(value: RegistryEntry): value is Fragment {
  return !isRejected(value) && value.meta.kind === "fragment";
}
export const markdownFile = (kind: Kind) => (kind === "stack" ? "STACK.md" : "FRAGMENT.md");

/**
 * The frontmatter between a first line of exactly `---` and the next line of exactly `---`, and
 * the body after it. No other markdown is parsed.
 */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const lines = text.split("\n");
  const plain = (line: string | undefined) => line?.replace(/\r$/, "");
  if (plain(lines[0]) !== "---") return undefined;
  const end = lines.findIndex((line, i) => i > 0 && plain(line) === "---");
  if (end === -1) return undefined;
  return {
    frontmatter: lines.slice(1, end).join("\n"),
    body: lines
      .slice(end + 1)
      .join("\n")
      .replace(/^\r?\n/, ""),
  };
}

type Decoded =
  | { _tag: "Meta"; meta: StackMeta | FragmentMeta; body: string }
  /** `schema_version` above 1. See `loadedCandidate` for the skip decision. */
  | { _tag: "Newer"; version: number }
  | { _tag: "Invalid"; error: string };

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

function yamlPath(segments: ReadonlyArray<PropertyKey | { key: PropertyKey }>): string {
  return segments
    .map((segment) => (typeof segment === "object" ? segment.key : segment))
    .reduce<string>((acc, key) => {
      if (typeof key === "number") return `${acc}[${key}]`;
      return acc ? `${acc}.${String(key)}` : String(key);
    }, "");
}

/** The first schema issue as one line, with its path in YAML spelling: `applies_to[0]: Expected string`. */
function issueLine(error: Schema.SchemaError): string {
  const [first] = formatter(error.issue).issues;
  if (!first) return "frontmatter: invalid";
  const path = yamlPath(first.path ?? []);
  const message = first.message.split("\n")[0] ?? "";
  if (message === "Expected no excess property") {
    // A camelCase key is the usual way to get this, so say what the spelling should be.
    const last = String(first.path?.at(-1) ?? "");
    return `${path}: unknown key${/[A-Z]/.test(last) ? " (frontmatter keys are snake_case)" : ""}`;
  }
  return `${path || "frontmatter"}: ${message}`;
}

/**
 * Check `kind` before decoding so fragment metadata in `STACK.md` reports the real mistake.
 * Classify newer schemas for `loadedCandidate`.
 */
function checkHeader(kind: Kind, value: unknown): Exclude<Decoded, { _tag: "Meta" }> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (
    "schema_version" in value &&
    typeof value.schema_version === "number" &&
    value.schema_version > 1
  )
    return { _tag: "Newer", version: value.schema_version };
  if ("kind" in value && typeof value.kind === "string" && value.kind !== kind)
    return {
      _tag: "Invalid",
      error: `kind: ${JSON.stringify(value.kind)} does not match ${markdownFile(kind)}`,
    };
  return undefined;
}

function yamlMessage(failure: unknown): string | undefined {
  return String(failure instanceof Error ? failure.message : failure).split("\n")[0];
}

/** The frontmatter as plain data, or the first YAML error or warning. */
function parseYaml(frontmatter: string): Result.Result<unknown, unknown> {
  // Silent: the library would otherwise print warnings (an unknown `!tag`) to stderr itself.
  const doc = parseDocument(frontmatter, { logLevel: "silent" });
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem) return Result.fail(problem);
  return Result.try(() => doc.toJS({ maxAliasCount: 100 }) as unknown);
}

const decodeMeta = (
  kind: Kind,
  value: unknown,
): Effect.Effect<StackMeta | FragmentMeta, Schema.SchemaError> =>
  kind === "stack"
    ? Schema.decodeUnknownEffect(StackMeta, { onExcessProperty: "error" })(value)
    : Schema.decodeUnknownEffect(FragmentMeta, { onExcessProperty: "error" })(value);

/** Splits, parses and decodes one entry's markdown file. Never fails: problems are values. */
export function decodeEntry(kind: Kind, text: string): Effect.Effect<Decoded> {
  return Effect.gen(function* () {
    const parts = splitFrontmatter(text);
    if (!parts)
      return {
        _tag: "Invalid",
        error: "frontmatter: the file must start with a --- line and close it with another",
      } as const;
    const yaml = parseYaml(parts.frontmatter);
    if (Result.isFailure(yaml))
      return {
        _tag: "Invalid",
        error: `frontmatter: not valid YAML (${yamlMessage(yaml.failure)})`,
      } as const;
    const header = checkHeader(kind, yaml.success);
    if (header) return header;
    const decoded = yield* Effect.result(decodeMeta(kind, yaml.success));
    return Result.isFailure(decoded)
      ? ({ _tag: "Invalid", error: issueLine(decoded.failure) } as const)
      : ({ _tag: "Meta", meta: decoded.success, body: parts.body } as const);
  });
}
