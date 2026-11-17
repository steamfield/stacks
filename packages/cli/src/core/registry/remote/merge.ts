/**
 * Merges index entries between the user and bundled roots. Bundle resolution is lazy and cached per
 * invocation so reading the catalog never downloads files.
 */
import { type IndexEntry, IndexEntry as IndexEntrySchema } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import {
  type CatalogEntry,
  catalogRow,
  compareEntries,
  decodeEntry,
  type Entry,
  entryKey,
  isRejected,
  markdownFile,
  type Origin,
  type RegistryEntry,
} from "../entry";
import { directoryMatches } from "./files";
import type { ConfiguredIndex } from "./service";

type Resolution = Effect.Effect<RegistryEntry | undefined>;

const aboveIndex = (entry: RegistryEntry | undefined) =>
  entry?.origin === "project" || entry?.origin === "user";

/** A missing, unreadable or invalid bundle has no entry, so resolution can fall back. */
const readEntry = Effect.fn("registry.remoteEntry")(function* (
  remote: ConfiguredIndex,
  ref: IndexEntry,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* remote.bundle(ref);
  if (Option.isNone(dir)) return undefined;
  const text = yield* fs
    .readFileString(path.join(dir.value, markdownFile(ref.kind)))
    .pipe(Effect.orElseSucceed(() => ""));
  const decoded = yield* decodeEntry(ref.kind, text);
  if (decoded._tag !== "Meta" || decoded.meta.id !== ref.id) return undefined;
  return {
    id: ref.id,
    kind: ref.kind,
    origin: remote.root.origin,
    dir: dir.value,
    trusted: remote.root.trusted,
    shadows: [],
    meta: decoded.meta,
    body: decoded.body,
    indexEntry: ref,
  } satisfies Entry;
});

/** The index reference for a pinned fragment, which the stack's index entry names only by digest. */
const pinnedReference = (id: string, digest: string): IndexEntry => ({
  id,
  digest,
  kind: "fragment",
  schemaVersion: 1,
  name: "",
  description: "",
  tags: [],
});

/**
 * Preserve the exact fragment versions and order the index stack was proven with. Use bundled
 * copies on digest matches and discard the whole pin set if any fragment is unavailable.
 */
const pinnedFragments = Effect.fn("registry.pinnedFragments")(function* (
  remote: ConfiguredIndex,
  ref: IndexEntry,
  bundledEntries: ReadonlyArray<Entry>,
) {
  const fragments: Entry[] = [];
  for (const [id, digest] of Object.entries(ref.composition ?? {})) {
    const original = bundledEntries.find((entry) => entry.kind === "fragment" && entry.id === id);
    if (
      original &&
      (yield* directoryMatches({ id, kind: "fragment", digest, dir: original.dir }))
    ) {
      fragments.push(original);
      continue;
    }
    const fragment = yield* readEntry(remote, pinnedReference(id, digest));
    if (!fragment) return undefined;
    fragments.push(fragment);
  }
  return fragments;
});

/**
 * Rebuild pins from the bundled stack's requirements and defaults if the index composition
 * cannot be used. Bundled fragments pass through.
 */
function bundledComposition(original: Entry | undefined, bundledEntries: ReadonlyArray<Entry>) {
  if (original?.meta.kind !== "stack") return original;
  const fragments = new Map(
    bundledEntries.filter((entry) => entry.kind === "fragment").map((entry) => [entry.id, entry]),
  );
  const selected = new Map<string, Entry>();
  // Depth first from the last id; the visiting order becomes the composition order.
  const pending = [...original.meta.fragments.required, ...original.meta.fragments.default];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const fragment = fragments.get(id);
    if (!fragment || selected.has(id) || fragment.meta.kind !== "fragment") continue;
    selected.set(id, fragment);
    pending.push(...fragment.meta.requires);
  }
  return { ...original, composition: [...selected.values()] };
}

/**
 * Reuse a bundled digest match to avoid a download and keep its run evidence applicable. Fall
 * back to `bundledComposition` when the index stack or a pinned fragment is unavailable.
 */
const resolveReference = Effect.fn("registry.resolveReference")(function* (
  ref: IndexEntry,
  options: {
    remote: ConfiguredIndex;
    original: Entry | undefined;
    bundledEntries: ReadonlyArray<Entry>;
  },
) {
  const { remote, original, bundledEntries } = options;
  const same = original && (yield* directoryMatches({ ...ref, dir: original.dir }));
  const entry = same ? original : yield* readEntry(remote, ref);
  if (!entry)
    return ref.kind === "stack" ? bundledComposition(original, bundledEntries) : undefined;
  const shadows: Entry["shadows"] = original ? ["bundled"] : [];
  if (ref.kind === "fragment") return same ? original : { ...entry, shadows };
  const pinned = yield* pinnedFragments(remote, ref, bundledEntries);
  if (pinned === undefined) return bundledComposition(original, bundledEntries);
  return { ...entry, composition: pinned, ...(same ? {} : { shadows }) };
});

const ORIGIN_ORDER: ReadonlyArray<Origin> = ["project", "user", "index", "bundled"];

/** A project or user entry that also hides an index copy: `index` joins its shadows, in order. */
function withIndexShadow(entry: RegistryEntry | undefined) {
  if (!entry || isRejected(entry)) return entry;
  const shadows: Origin[] = [...entry.shadows, "index"];
  return {
    ...entry,
    shadows: [...new Set(shadows)].sort(
      (a, b) => ORIGIN_ORDER.indexOf(a) - ORIGIN_ORDER.indexOf(b),
    ),
  };
}

const indexCatalogRow = (ref: IndexEntry): CatalogEntry => ({
  id: ref.id,
  kind: ref.kind,
  origin: "index",
  tags: ref.tags,
  rejected: false,
});

/**
 * Ignore references with newer or invalid schemas. For a winning project or user entry, record
 * the index as a shadow.
 */
const mergeIndex = Effect.fn("registry.mergeIndex")(function* (
  remote: ConfiguredIndex,
  options: {
    local: ReadonlyMap<string, RegistryEntry>;
    bundledEntries: ReadonlyArray<Entry>;
    catalog: Map<string, CatalogEntry>;
    resolutions: Map<string, Resolution>;
  },
) {
  const { local, bundledEntries, catalog, resolutions } = options;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const index = yield* remote.current;
  const originals = new Map(bundledEntries.map((entry) => [entryKey(entry.kind, entry.id), entry]));
  for (const ref of Option.isSome(index) ? index.value.entries : []) {
    if (ref.schemaVersion > 1 || !Schema.is(IndexEntrySchema)(ref)) continue;
    const key = entryKey(ref.kind, ref.id);
    const existing = local.get(key);
    if (aboveIndex(existing)) {
      resolutions.set(key, Effect.succeed(withIndexShadow(existing)));
      continue;
    }
    catalog.set(key, indexCatalogRow(ref));
    const resolve = yield* Effect.cached(
      resolveReference(ref, { remote, original: originals.get(key), bundledEntries }).pipe(
        Effect.map((entry) => entry ?? existing),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      ),
    );
    resolutions.set(key, resolve);
  }
});

export const remoteRegistry = Effect.fn("registry.remoteRegistry")(function* (
  remote: ConfiguredIndex,
  local: ReadonlyMap<string, RegistryEntry>,
  bundledEntries: ReadonlyArray<Entry>,
) {
  const catalog = new Map(Array.from(local, ([key, entry]) => [key, catalogRow(entry)]));
  const resolutions = new Map<string, Resolution>(
    Array.from(local, ([key, entry]) => [key, Effect.succeed(entry)]),
  );
  yield* mergeIndex(remote, { local, bundledEntries, catalog, resolutions });
  return {
    catalog: Effect.succeed([...catalog.values()].sort(compareEntries)),
    all: Effect.forEach([...resolutions.values()], (effect) => effect).pipe(
      Effect.map((entries) => entries.filter((entry) => entry !== undefined).sort(compareEntries)),
    ),
    get: (kind: Entry["kind"], id: string) =>
      resolutions.get(entryKey(kind, id)) ?? Effect.succeed(undefined),
  };
});
