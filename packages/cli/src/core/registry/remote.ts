/**
 * Merges the signed remote index into the registry, between the user root and the bundled one.
 *
 * The index is a published list of entries (`IndexEntry`: kind, id, tags and a content digest)
 * whose files are downloaded as bundles on demand through `core/remote-index.ts::RemoteIndex`.
 * `registry.ts` hands this module the local winners and the bundled root's entries;
 * `remoteRegistry` returns the merged catalog, listing and lookup the `Registry` service exposes.
 *
 * Precedence follows the root order. A project or user entry beats the index, which only adds
 * `index` to its shadows. An index entry beats a bundled one, but when the bundled copy's files
 * match the index digest the bundled entry is used as is (same directory, same identity), so
 * nothing is downloaded and run evidence still matches. A stack from the index also pins the exact
 * default fragments it was proven with (`composition`); if any of them can't be had, the bundled
 * stack is used with its own bundled fragments. Index entries are trusted only from the official
 * URL (Trust model, point 2).
 *
 * Downloads are lazy: reading names (`catalog`) never fetches a bundle, and each entry's
 * resolution is cached for this invocation only. Start at `remoteRegistry`.
 */
import { type IndexEntry, IndexEntry as IndexEntrySchema } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { RemoteIndex } from "../remote-index";
import { directoryMatches } from "../remote-index/files";
import {
  type CatalogEntry,
  decodeEntry,
  type Entry,
  markdownFile,
  type Origin,
  type RejectedEntry,
} from "./entry";

type Resolution = Effect.Effect<Entry | RejectedEntry | undefined>;

const entryKey = (entry: Pick<Entry, "kind" | "id">) => `${entry.kind}/${entry.id}`;

/** Whether an entry comes from a root above the index (project or user). */
const aboveIndex = (entry: Entry | RejectedEntry | undefined) =>
  entry?.origin === "project" || entry?.origin === "user";

/**
 * Downloads one index entry's bundle and decodes its markdown. Any problem (no bundle, an
 * unreadable or invalid file, an id that doesn't match) means no entry, never a failure.
 */
const readEntry = Effect.fn("registry.remoteEntry")(function* (
  remote: RemoteIndex["Service"],
  ref: IndexEntry,
  trusted: boolean,
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
    origin: "index",
    dir: dir.value,
    trusted,
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
 * The fragments an index stack was proven with, in its `composition` order: the bundled copy
 * when its files match the pinned digest, otherwise the download. Undefined when any is missing.
 */
const pinnedFragments = Effect.fn("registry.pinnedFragments")(function* (
  remote: RemoteIndex["Service"],
  ref: IndexEntry,
  options: { trusted: boolean; bundled: ReadonlyArray<Entry> },
) {
  const fragments: Entry[] = [];
  for (const [id, digest] of Object.entries(ref.composition ?? {})) {
    const original = options.bundled.find((entry) => entry.kind === "fragment" && entry.id === id);
    if (
      original &&
      (yield* directoryMatches({ id, kind: "fragment", digest, dir: original.dir }))
    ) {
      fragments.push(original);
      continue;
    }
    const fragment = yield* readEntry(remote, pinnedReference(id, digest), options.trusted);
    if (!fragment) return undefined;
    fragments.push(fragment);
  }
  return fragments;
});

/**
 * The bundled stack with its bundled required and default fragments, and what they require,
 * pinned as its composition: the fallback when the index copy can't be used. A fragment entry
 * comes back unchanged.
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
 * Resolves one index reference to the entry `get` hands back. A bundled copy with matching files
 * is reused; otherwise the bundle is downloaded and shadows the bundled copy. A stack also gets
 * its pinned fragments, or falls back to `bundledComposition` when the stack or a fragment can't
 * be read.
 */
const resolveReference = Effect.fn("registry.resolveReference")(function* (
  ref: IndexEntry,
  options: {
    remote: RemoteIndex["Service"];
    trusted: boolean;
    original: Entry | undefined;
    bundled: ReadonlyArray<Entry>;
  },
) {
  const { remote, trusted, original, bundled } = options;
  const same = original && (yield* directoryMatches({ ...ref, dir: original.dir }));
  const entry = same ? original : yield* readEntry(remote, ref, trusted);
  if (!entry) return ref.kind === "stack" ? bundledComposition(original, bundled) : undefined;
  const shadows: Entry["shadows"] = original ? ["bundled"] : [];
  if (ref.kind === "fragment") return same ? original : { ...entry, shadows };
  const pinned = yield* pinnedFragments(remote, ref, { trusted, bundled });
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
 * Adds each usable index reference to `catalog` and `resolutions`. A reference this CLI can't
 * read (newer schema, invalid shape) is ignored; one a project or user entry hides only adds to
 * that entry's shadows.
 */
const mergeIndex = Effect.fn("registry.mergeIndex")(function* (
  remote: RemoteIndex["Service"],
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
  const { trusted } = remote;
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
      resolveReference(ref, { remote, trusted, original: originals.get(key), bundled }).pipe(
        Effect.map((entry) => entry ?? existing),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      ),
    );
    resolutions.set(key, resolve);
  }
});

/**
 * The registry view over the local winners plus, when `enabled` and a `RemoteIndex` is provided,
 * the index: its catalog, its full listing and a lookup by kind and id. Bundle effects are cached
 * per entry; reading names never evaluates them.
 */
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
  if (Option.isSome(service))
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

/** Stacks first, then fragments, each by id. */
function compareEntries(a: Pick<Entry, "id" | "kind">, b: Pick<Entry, "id" | "kind">): number {
  if (a.kind !== b.kind) return a.kind === "stack" ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
