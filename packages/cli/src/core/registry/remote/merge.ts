/**
 * Merges index entries between the user and bundled roots. Bundle resolution is lazy and cached per
 * invocation so reading the catalog never downloads files.
 */
import { type IndexEntry, IndexEntry as IndexEntrySchema } from "@steamfield/stacks-format";
import { Clock, Effect, Fiber, Option, Schema, type Scope, Semaphore } from "effect";
import { INDEX_REFRESH_DEADLINE_MS } from "../../../constants";
import {
  type CatalogEntry,
  catalogRow,
  compareEntries,
  decodeEntry,
  type Entry,
  entryKey,
  isRejected,
  isStack,
  markdownFile,
  type Origin,
  type RegistryEntry,
  type Stack,
} from "../entry";
import type { FileAccess } from "../types";
import { directoryMatches } from "./files";
import type { ConfiguredIndex } from "./service";

type Resolution = (deadline?: number) => Effect.Effect<RegistryEntry | undefined>;
const RESOLUTION_CONCURRENCY = 8;

const aboveIndex = (entry: RegistryEntry | undefined) =>
  entry?.origin === "project" || entry?.origin === "user";

/** A missing, unreadable or invalid bundle has no entry, so resolution can fall back. */
const readEntry = Effect.fn("registry.remoteEntry")(function* (
  { fs, path }: FileAccess,
  remote: ConfiguredIndex,
  ref: IndexEntry,
) {
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

type Pin = Pick<IndexEntry, "kind" | "id" | "digest">;

/** The index reference for a pinned fragment or part stack, which the index names only by digest. */
const pinnedReference = ({ kind, id, digest }: Pin): IndexEntry => ({
  id,
  digest,
  kind,
  schemaVersion: 1,
  name: "",
  description: "",
  tags: [],
  ...(kind === "stack" ? { composition: {} } : {}),
});

/** A pinned entry: the bundled copy when its directory matches the digest, else the download. */
const pinnedEntry = Effect.fn("registry.pinnedEntry")(function* (
  io: FileAccess,
  remote: ConfiguredIndex,
  pin: Pin,
  bundledEntries: ReadonlyArray<Entry>,
) {
  const original = bundledEntries.find((entry) => entry.kind === pin.kind && entry.id === pin.id);
  if (original && (yield* directoryMatches(io, { ...pin, dir: original.dir }))) return original;
  return yield* readEntry(io, remote, pinnedReference(pin));
});

/**
 * Preserve the exact fragment versions and order the index stack was proven with. Use bundled
 * copies on digest matches and discard the whole pin set if any fragment is unavailable.
 */
const pinnedFragments = Effect.fn("registry.pinnedFragments")(function* (
  io: FileAccess,
  remote: ConfiguredIndex,
  ref: IndexEntry,
  bundledEntries: ReadonlyArray<Entry>,
) {
  const fragments: Entry[] = [];
  for (const [id, digest] of Object.entries(ref.composition ?? {})) {
    const fragment = yield* pinnedEntry(
      io,
      remote,
      { kind: "fragment", id, digest },
      bundledEntries,
    );
    if (!fragment) return undefined;
    fragments.push(fragment);
  }
  return fragments;
});

/**
 * The part stacks a workspace was proven with, by part name, read the way `pinnedFragments`
 * reads fragments; `undefined` when any one is unavailable, so the caller drops the whole pin set.
 */
const pinnedParts = Effect.fn("registry.pinnedParts")(function* (
  io: FileAccess,
  remote: ConfiguredIndex,
  ref: IndexEntry,
  bundledEntries: ReadonlyArray<Entry>,
) {
  const parts: Record<string, Entry> = {};
  for (const [name, { stack, digest }] of Object.entries(ref.parts ?? {})) {
    const part = yield* pinnedEntry(
      io,
      remote,
      { kind: "stack", id: stack, digest },
      bundledEntries,
    );
    if (!part) return undefined;
    parts[name] = part;
  }
  return parts;
});

/**
 * Everything the index workspace or stack pins: its fragments, and its parts when it has any.
 * `undefined` when one pin is unavailable.
 */
const pinnedSnapshot = Effect.fn("registry.pinnedSnapshot")(function* (
  io: FileAccess,
  remote: ConfiguredIndex,
  ref: IndexEntry,
  bundledEntries: ReadonlyArray<Entry>,
) {
  const composition = yield* pinnedFragments(io, remote, ref, bundledEntries);
  if (composition === undefined) return undefined;
  if (ref.parts === undefined) return { composition };
  const partEntries = yield* pinnedParts(io, remote, ref, bundledEntries);
  return partEntries === undefined ? undefined : { composition, partEntries };
});

/** A bundled workspace's part stacks from the same bundled root, by part name. */
function bundledParts(stack: Stack, bundledEntries: ReadonlyArray<Entry>) {
  const parts: Record<string, Entry> = {};
  for (const part of stack.meta.parts ?? []) {
    const entry = bundledEntries.find((item) => item.kind === "stack" && item.id === part.stack);
    if (entry) parts[part.name] = entry;
  }
  return parts;
}

/**
 * Rebuild pins from the bundled stack's requirements and defaults if the index composition
 * cannot be used. Bundled fragments pass through. A bundled workspace keeps its bundled parts,
 * so no index part is composed with a workspace it wasn't proven with.
 */
function bundledComposition(original: Entry | undefined, bundledEntries: ReadonlyArray<Entry>) {
  if (!original || !isStack(original)) return original;
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
  const parts = original.meta.parts ? { partEntries: bundledParts(original, bundledEntries) } : {};
  return { ...original, composition: [...selected.values()], ...parts };
}

/**
 * Whether the index entry pins exactly the workspace's parts: every part name, to the stack id its
 * decoded meta names, and nothing else. A stack without parts needs no part pin. Anything less
 * would compose some part from the catalog's current copy, which the workspace wasn't proven with.
 */
function pinCoversParts(entry: Entry, ref: IndexEntry): boolean {
  if (!isStack(entry) || !entry.meta.parts) return true;
  const pins = ref.parts;
  if (pins === undefined) return false;
  const parts = entry.meta.parts;
  return (
    Object.keys(pins).length === parts.length &&
    parts.every((part) => Object.hasOwn(pins, part.name) && pins[part.name]?.stack === part.stack)
  );
}

/**
 * Reuse a bundled digest match to avoid a download and keep its run evidence applicable. Fall
 * back to `bundledComposition` when the index stack, a pinned fragment or a pinned part is
 * unavailable, or when the part pin doesn't cover the workspace's parts (`pinCoversParts`).
 */
const resolveReference = Effect.fn("registry.resolveReference")(function* (
  io: FileAccess,
  ref: IndexEntry,
  options: {
    remote: ConfiguredIndex;
    original: Entry | undefined;
    bundledEntries: ReadonlyArray<Entry>;
  },
) {
  const { remote, original, bundledEntries } = options;
  const same = original && (yield* directoryMatches(io, { ...ref, dir: original.dir }));
  const entry = same ? original : yield* readEntry(io, remote, ref);
  if (!entry)
    return ref.kind === "stack" ? bundledComposition(original, bundledEntries) : undefined;
  const shadows: Entry["shadows"] = original ? ["bundled"] : [];
  if (ref.kind === "fragment") return same ? original : { ...entry, shadows };
  if (!pinCoversParts(entry, ref)) return bundledComposition(original, bundledEntries);
  const pinned = yield* pinnedSnapshot(io, remote, ref, bundledEntries);
  if (pinned === undefined) return bundledComposition(original, bundledEntries);
  return { ...entry, ...pinned, ...(same ? {} : { shadows }) };
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

const indexResolution = Effect.fn("registry.indexResolution")(function* (
  resolve: Effect.Effect<RegistryEntry | undefined>,
  fallback: () => Entry | undefined,
  options: { scope: Scope.Scope; permits: Semaphore.Semaphore },
) {
  let running: Fiber.Fiber<RegistryEntry | undefined> | undefined;
  const start = yield* Effect.cached(
    resolve.pipe(
      options.permits.withPermit,
      Effect.forkIn(options.scope),
      Effect.tap((fiber) =>
        Effect.sync(() => {
          running = fiber;
        }),
      ),
    ),
  );
  const get = start.pipe(Effect.flatMap(Fiber.join));
  return Effect.fnUntraced(function* (deadline?: number) {
    if (deadline === undefined) return yield* get;
    const remaining = deadline - (yield* Clock.currentTimeMillis);
    // A later read can still see completed resolutions after the budget has expired.
    const settled = running?.pollUnsafe();
    if (settled !== undefined) return yield* settled;
    if (remaining <= 0) return fallback();
    // Time out the join, leaving the download in the registry scope for later readers.
    const fiber = yield* start;
    const result = yield* Fiber.join(fiber).pipe(Effect.timeoutOption(remaining));
    return Option.getOrElse(result, fallback);
  });
});

/**
 * Ignore references with newer or invalid schemas. For a winning project or user entry, record
 * the index as a shadow.
 */
const mergeIndex = Effect.fn("registry.mergeIndex")(function* (
  io: FileAccess,
  remote: ConfiguredIndex,
  options: {
    local: ReadonlyMap<string, RegistryEntry>;
    bundledEntries: ReadonlyArray<Entry>;
    catalog: Map<string, CatalogEntry>;
    resolutions: Map<string, Resolution>;
    scope: Scope.Scope;
  },
) {
  const { local, bundledEntries, catalog, resolutions, scope } = options;
  const index = yield* remote.current;
  const originals = new Map(bundledEntries.map((entry) => [entryKey(entry.kind, entry.id), entry]));
  // Resolutions that outlive an all read still occupy their slots until they finish.
  const permits = yield* Semaphore.make(RESOLUTION_CONCURRENCY);
  for (const ref of Option.isSome(index) ? index.value.entries : []) {
    if (ref.schemaVersion > 1 || !Schema.is(IndexEntrySchema)(ref)) continue;
    const key = entryKey(ref.kind, ref.id);
    const existing = local.get(key);
    if (aboveIndex(existing)) {
      const shadowed = withIndexShadow(existing);
      resolutions.set(key, () => Effect.succeed(shadowed));
      continue;
    }
    catalog.set(key, indexCatalogRow(ref));
    const original = originals.get(key);
    const resolve = yield* indexResolution(
      resolveReference(io, ref, { remote, original, bundledEntries }).pipe(
        Effect.map((entry) => entry ?? existing),
      ),
      () => bundledComposition(original, bundledEntries),
      { scope, permits },
    );
    resolutions.set(key, original === undefined ? () => resolve() : resolve);
  }
});

export const remoteRegistry = Effect.fn("registry.remoteRegistry")(function* (
  io: FileAccess,
  remote: ConfiguredIndex,
  local: ReadonlyMap<string, RegistryEntry>,
  options: { bundledEntries: ReadonlyArray<Entry>; scope: Scope.Scope },
) {
  const catalog = new Map(Array.from(local, ([key, entry]) => [key, catalogRow(entry)]));
  const resolutions = new Map<string, Resolution>(
    Array.from(local, ([key, entry]) => [key, () => Effect.succeed(entry)]),
  );
  yield* mergeIndex(io, remote, { ...options, local, catalog, resolutions });
  let deadline: number | undefined;
  return {
    catalog: Effect.succeed([...catalog.values()].sort(compareEntries)),
    all: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      deadline ??= now + INDEX_REFRESH_DEADLINE_MS;
      const cutoff = deadline;
      const entries = yield* Effect.forEach(resolutions.values(), (resolve) => resolve(cutoff), {
        concurrency: RESOLUTION_CONCURRENCY,
      });
      return entries.filter((entry) => entry !== undefined).sort(compareEntries);
    }),
    get: (kind: Entry["kind"], id: string) =>
      resolutions.get(entryKey(kind, id))?.() ?? Effect.succeed(undefined),
  };
});
