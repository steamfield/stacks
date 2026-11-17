/**
 * Merges index entries between the user and bundled roots. Bundle resolution is lazy and cached per
 * invocation so reading the catalog never downloads files.
 */
import { type IndexEntry, IndexEntry as IndexEntrySchema } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import {
  type CatalogEntry,
  decodeEntry,
  type Entry,
  markdownFile,
  type Origin,
  type RejectedEntry,
} from "../entry";
import { directoryMatches } from "./files";
import { type ConfiguredIndex, RemoteIndex } from "./service";

type Resolution = Effect.Effect<Entry | RejectedEntry | undefined>;

const entryKey = (entry: Pick<Entry, "kind" | "id">) => `${entry.kind}/${entry.id}`;

const aboveIndex = (entry: Entry | RejectedEntry | undefined) =>
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
  bundled: ReadonlyArray<Entry>,
) {
  const fragments: Entry[] = [];
  for (const [id, digest] of Object.entries(ref.composition ?? {})) {
    const original = bundled.find((entry) => entry.kind === "fragment" && entry.id === id);
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
function bundledComposition(original: Entry | undefined, bundled: ReadonlyArray<Entry>) {
  if (original?.meta.kind !== "stack") return original;
  const fragments = new Map(
    bundled.filter((entry) => entry.kind === "fragment").map((entry) => [entry.id, entry]),
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
    bundled: ReadonlyArray<Entry>;
  },
) {
  const { remote, original, bundled } = options;
  const same = original && (yield* directoryMatches({ ...ref, dir: original.dir }));
  const entry = same ? original : yield* readEntry(remote, ref);
  if (!entry) return ref.kind === "stack" ? bundledComposition(original, bundled) : undefined;
  const shadows: Entry["shadows"] = original ? ["bundled"] : [];
  if (ref.kind === "fragment") return same ? original : { ...entry, shadows };
  const pinned = yield* pinnedFragments(remote, ref, bundled);
  if (pinned === undefined) return bundledComposition(original, bundled);
  return { ...entry, composition: pinned, ...(same ? {} : { shadows }) };
});

const ORIGIN_ORDER: ReadonlyArray<Origin> = ["project", "user", "index", "bundled"];

/** A project or user entry that also hides an index copy: `index` joins its shadows, in order. */
function withIndexShadow(entry: Entry | RejectedEntry | undefined) {
  if (!entry || !("meta" in entry)) return entry;
  const shadows: Origin[] = [...entry.shadows, "index"];
  return {
    ...entry,
    shadows: [...new Set(shadows)].sort(
      (a, b) => ORIGIN_ORDER.indexOf(a) - ORIGIN_ORDER.indexOf(b),
    ),
  };
}

function catalogRow(entry: Entry | RejectedEntry): CatalogEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    origin: entry.origin,
    tags: "meta" in entry ? entry.meta.tags : [],
    rejected: !("meta" in entry),
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
    local: ReadonlyArray<Entry | RejectedEntry>;
    bundled: ReadonlyArray<Entry>;
    catalog: Map<string, CatalogEntry>;
    resolutions: Map<string, Resolution>;
  },
) {
  const { local, bundled, catalog, resolutions } = options;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const index = yield* remote.current;
  const originals = new Map(bundled.map((entry) => [entryKey(entry), entry]));
  const locals = new Map(local.map((entry) => [entryKey(entry), entry]));
  for (const ref of Option.isSome(index) ? index.value.entries : []) {
    if (ref.schemaVersion > 1 || !Schema.is(IndexEntrySchema)(ref)) continue;
    const key = entryKey(ref);
    const existing = locals.get(key);
    if (aboveIndex(existing)) {
      resolutions.set(key, Effect.succeed(withIndexShadow(existing)));
      continue;
    }
    catalog.set(key, indexCatalogRow(ref));
    const resolve = yield* Effect.cached(
      resolveReference(ref, { remote, original: originals.get(key), bundled }).pipe(
        Effect.map((entry) => entry ?? existing),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      ),
    );
    resolutions.set(key, resolve);
  }
});

export const remoteRegistry = Effect.fn("registry.remoteRegistry")(function* (
  local: ReadonlyArray<Entry | RejectedEntry>,
  bundled: ReadonlyArray<Entry>,
  enabled: boolean,
) {
  const catalog = new Map(local.map((entry) => [entryKey(entry), catalogRow(entry)]));
  const resolutions = new Map<string, Resolution>(
    local.map((entry) => [entryKey(entry), Effect.succeed(entry)]),
  );
  const service = enabled ? yield* Effect.serviceOption(RemoteIndex) : Option.none();
  if (Option.isSome(service) && service.value.root !== undefined)
    yield* mergeIndex(service.value, { local, bundled, catalog, resolutions });
  return {
    catalog: [...catalog.values()].sort(compareEntries),
    all: Effect.forEach([...resolutions.values()], (effect) => effect).pipe(
      Effect.map((entries) => entries.filter((entry) => entry !== undefined).sort(compareEntries)),
    ),
    get: (kind: Entry["kind"], id: string) =>
      resolutions.get(entryKey({ kind, id })) ?? Effect.succeed(undefined),
  };
});

function compareEntries(a: Pick<Entry, "id" | "kind">, b: Pick<Entry, "id" | "kind">): number {
  if (a.kind !== b.kind) return a.kind === "stack" ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
