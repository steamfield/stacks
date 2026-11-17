/**
 * Builds catalog rows and identifies addable project fragments. Published evidence applies only to
 * bundled and index entries because only those were proven or counted by maintainers.
 */
import {
  type AuthorsFile,
  authorKey,
  type Kind,
  type Manifest,
  type StatsSummary,
} from "@steamfield/stacks-format";
import { Schema } from "effect";
import { LedgerLastRun, type LedgerRecord } from "../schemas/ledger";
import type { ListResult, ListRow } from "../schemas/list";
import { fitsStack } from "./compose/selection";
import { lastRun } from "./ledger";
import { type Entry, isRejected, type RejectedEntry } from "./registry/entry";
import { statsFields } from "./stats-text";

export const groups = ["stacks", "fragments", "apps"] as const;
export type Group = (typeof groups)[number];

/**
 * `records` is the bundled ledger, so only bundled stacks get a `lastRun` from it; `authors` is
 * the bundled `authors.json`, which names creators only for bundled entries.
 */
export function toRow(
  entry: Entry,
  records: ReadonlyArray<LedgerRecord> = [],
  authors: AuthorsFile = {},
): ListRow {
  const { meta } = entry;
  const author = rowAuthor(entry, authors);
  return {
    id: entry.id,
    kind: entry.kind,
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
    ...(meta.kind === "fragment" ? { category: meta.category, appliesTo: meta.appliesTo } : {}),
    origin: entry.origin,
    trusted: entry.trusted,
    shadows: entry.shadows,
    ...(author === undefined ? {} : { author }),
    lastRun: rowLastRun(entry, records),
  };
}

function rowAuthor(entry: Entry, authors: AuthorsFile): string | undefined {
  if (entry.indexEntry?.author !== undefined) return entry.indexEntry.author;
  const key = authorKey(entry.kind, entry.id);
  return entry.origin === "bundled" && Object.hasOwn(authors, key) ? authors[key] : undefined;
}

/** The index entry's signed proof, else a bundled stack's latest default run, else `null`. */
function rowLastRun(entry: Entry, records: ReadonlyArray<LedgerRecord>) {
  if (entry.indexEntry?.lastRun)
    return Schema.decodeUnknownSync(LedgerLastRun)(entry.indexEntry.lastRun);
  return entry.kind === "stack" && entry.origin === "bundled" ? lastRun(records, entry.id) : null;
}

export const inGroup = (row: ListRow, group: Group | undefined) =>
  group === undefined ||
  (group === "stacks" && row.kind === "stack") ||
  (group === "fragments" && row.kind === "fragment" && row.category !== "app") ||
  (group === "apps" && row.category === "app");

/**
 * `rows` with the published summary's stats attached to each bundled or index row it covers.
 * An unpublished or missing summary leaves the rows as they are.
 */
export function withStats(
  rows: ReadonlyArray<ListRow>,
  summary: StatsSummary | undefined,
): ListRow[] {
  if (!summary?.published) return [...rows];
  const items = new Map(summary.items.map((item) => [`${item.kind}:${item.id}`, item]));
  return rows.map((row) => {
    if (row.origin !== "bundled" && row.origin !== "index") return row;
    const item = items.get(`${row.kind}:${row.id}`);
    if (!item) return row;
    return { ...row, stats: statsFields(summary, item) };
  });
}

/** The `list` result: entries in `group` (all when absent), and rejected entries of its kind. */
export function listResult(
  items: ReadonlyArray<Entry | RejectedEntry>,
  group: Group | undefined,
  records: ReadonlyArray<LedgerRecord> = [],
  authors: AuthorsFile = {},
): ListResult {
  const kind = groupKind(group);
  return {
    entries: items
      .filter((item): item is Entry => !isRejected(item))
      .map((entry) => toRow(entry, records, authors))
      .filter((row) => inGroup(row, group)),
    rejected: items
      .filter(isRejected)
      .filter((item) => kind === undefined || item.kind === kind)
      .map(({ id, kind, origin, dir, error }) => ({ id, kind, origin, dir, error })),
  };
}

/** The entry kind a group holds (apps are fragments); `undefined` for every group. */
function groupKind(group: Group | undefined): Kind | undefined {
  if (group === undefined) return undefined;
  return group === "stacks" ? "stack" : "fragment";
}

/**
 * What a project can still add. `project` summarizes the manifest (its stack, applied fragments
 * and addable ids) and is absent outside a project. `addable` holds the fragments not yet applied
 * that fit the project's stack, or every unapplied fragment when the stack isn't in the registry.
 */
export function projectChoices(all: ReadonlyArray<ListRow>, manifest: Manifest | undefined) {
  const stack = all.find((row) => row.kind === "stack" && row.id === manifest?.stack?.id);
  const applied = manifest?.fragments.map((entry) => entry.id) ?? [];
  const addable = all.filter(
    (row) =>
      row.kind === "fragment" &&
      !applied.includes(row.id) &&
      (!stack || fitsStack(row.appliesTo ?? [], stack)),
  );
  const project = manifest
    ? { stack: manifest.stack?.id ?? null, applied, addable: addable.map((row) => row.id) }
    : undefined;
  return { project, addable };
}
