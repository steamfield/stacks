/**
 * What an entry is once the registry has read it, and how its markdown file is decoded.
 *
 * An entry is a stack (a recipe for a whole new project, `stacks/<id>/STACK.md`) or a fragment (a
 * reusable addition such as CI or a database, `fragments/<id>/FRAGMENT.md`), plus the files it
 * ships. The markdown file opens with YAML frontmatter (the metadata between two `---` lines) and
 * continues with the guidance body that goes into the brief. `decodeEntry` turns that text into
 * metadata and body, or into a one-line problem that `list` and `validate` show the user, so
 * those messages are user-visible text.
 *
 * `registry.ts` and `remote.ts` build `Entry` values with `decodeEntry`; composition, `show`,
 * `validate` and the rest read them. `shipsFor` and `shippedOnlyFor` decide which shipped files
 * reach a project, on top of `shippedPath` from `@steamfield/stacks-format`, which maps a file's
 * place in the entry (`files/`, an agent adapter, a stack overlay, a payload) to its project path.
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
  /** The directory name. */
  id: string;
  kind: Kind;
  origin: Origin;
  dir: string;
  /** One line naming the field or rule. */
  error: string;
};
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

/** Whether a source is one agent's adapter file or one stack's overlay file. */
export function shippedOnlyFor(source: string, kind: "agent" | "stack", id: string): boolean {
  const condition = shippedPath(source)?.condition;
  return condition?.kind === kind && condition.id === id;
}

/**
 * Whether a source ships to a project for these agents, host stack and payload: shared files
 * always, an adapter for a targeted agent, an overlay for its own stack, a payload variant when it
 * is the selected one. Composition and validate share it.
 */
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

export function isRejected(value: Entry | RejectedEntry): value is RejectedEntry {
  return "error" in value;
}
/** A loaded (not rejected) stack. */
export function isStack(value: Entry | RejectedEntry): value is Entry & { meta: StackMeta } {
  return "meta" in value && value.meta.kind === "stack";
}
/** A loaded fragment. */
export function isFragment(value: Entry): value is Entry & { meta: FragmentMeta } {
  return value.meta.kind === "fragment";
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
  /** `schema_version` above 1: the caller skips this copy and uses the next origin's. */
  | { _tag: "Newer"; version: number }
  | { _tag: "Invalid"; error: string };

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

/** A schema issue path in YAML spelling: `fragments.default[0]`. */
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
 * The checks made before the schema decode: a newer `schema_version` (skipped, not invalid), then
 * a `kind` that doesn't match the file name. Checking `kind` before the schema means a
 * FRAGMENT.md's frontmatter in a STACK.md names the real mistake.
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
