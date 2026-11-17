/**
 * Resolves entries by registry precedence, with trust assigned by `trustOf` (trust point 2).
 * Per-invocation caching keeps catalog reads cheap and deep checks lazy and per-entry.
 */
import { type AuthorsFile, Ecosystem, type Kind } from "@steamfield/stacks-format";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { AppConfig } from "../../config";
import { EntryInvalid, NotFound, PermissionDenied } from "../../errors";
import { METADATA_DIR } from "../../project-layout";
import { Host } from "../../services/host";
import { decodeAuthors, readSearchFile, sidecarPath } from "../search/sidecar";
import { printable } from "../text";
import type { CatalogEntry, Entry, EntryFile, Origin, RejectedEntry } from "./entry";
import { type LoadState, loadRoot } from "./load";
import { remoteRegistry } from "./remote";
import { entryTree, readEntryFile, shippedFiles } from "./tree";
import type { FileAccess, RegistryRoot, Rejection, RootCandidate, Skipped } from "./types";

export type { Skipped } from "./types";

export type RegistryRoots = ReadonlyArray<RegistryRoot>;

/** Candidates per `kind/id`, in root order: the first is the winner, the rest it hides. */
type FoundCandidates = ReadonlyMap<string, ReadonlyArray<RootCandidate>>;

/**
 * Whether an entry is trusted, by origin and root: project entries never are, nor are entries
 * from a bundled root set by STACKS_REGISTRY_DIR; user entries and the shipped bundled ones are
 * (Trust model, point 2).
 */
export function trustOf(entry: Pick<Entry, "origin">, root: RegistryRoot): boolean {
  return entry.origin !== "project" && !root.overridden;
}

/**
 * The bundled root: STACKS_REGISTRY_DIR resolved against the cwd when set, else
 * `Host.registry`. `found` when it is a directory; a variable naming no directory is a warning.
 */
export const bundledRoot = Effect.gen(function* () {
  const host = yield* Host;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* (yield* AppConfig).paths;
  const overridden = paths.registry !== undefined;
  // resolve also drops the trailing slash a URL-derived Host.registry keeps, which validate's
  // root comparison depends on.
  const at = path.resolve(host.cwd, paths.registry ?? host.registry);
  const found = yield* fs.stat(at).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );
  if (overridden && !found)
    yield* Effect.logWarning(`STACKS_REGISTRY_DIR is not a directory: ${printable(at)}`);
  return { path: at, overridden, found };
});

/** `project`, `user`, `bundled`: `./.stacks/` in the cwd, the user directory, `bundledRoot`. */
export const defaultRoots = Effect.gen(function* () {
  const host = yield* Host;
  const path = yield* Path.Path;
  const paths = yield* (yield* AppConfig).paths;
  const bundled = yield* bundledRoot;
  return [
    { origin: "project", path: path.join(host.cwd, METADATA_DIR) },
    { origin: "user", path: paths.user },
    { origin: "bundled", path: bundled.path, overridden: bundled.overridden },
  ] satisfies RegistryRoots;
});

/** Only entry-consuming commands opt into network-backed registry resolution. */
export const remoteRoots = defaultRoots.pipe(
  Effect.map((roots) =>
    roots.map((root) => (root.origin === "bundled" ? { ...root, remote: true } : root)),
  ),
);

function hidesText(shadows: ReadonlyArray<Origin>): string {
  if (!shadows.length) return "";
  return `; hides ${shadows.join(" and ")} cop${shadows.length > 1 ? "ies" : "y"}`;
}

/** Keep shadow origins in root order so rejection messages reflect precedence. */
const hiddenOrigins = (hidden: ReadonlyArray<RootCandidate>) => [
  ...new Set(hidden.map(({ root }) => root.origin)),
];

/** Sort stacks before fragments, then by id. A rejected winner still hides lower-priority copies. */
function registryWinners(found: FoundCandidates) {
  const results: Array<Entry | Rejection> = [];
  for (const [winner, ...hidden] of found.values()) {
    if (!winner) continue;
    const shadows = hiddenOrigins(hidden);
    const { candidate } = winner;
    if (candidate._tag === "Entry") {
      const entry = { ...candidate.entry, shadows };
      results.push({ ...entry, trusted: trustOf(entry, winner.root) });
    } else {
      const { rejected } = candidate.rejection;
      results.push({
        ...candidate.rejection,
        rejected: { ...rejected, error: `${rejected.error}${hidesText(shadows)}` },
      });
    }
  }
  const sortKey = (value: Entry | Rejection) => ("rejected" in value ? value.rejected : value);
  return results.sort((a, b) => {
    const x = sortKey(a);
    const y = sortKey(b);
    if (x.kind !== y.kind) return x.kind === "stack" ? -1 : 1;
    return x.id < y.id ? -1 : 1;
  });
}

/** Each winner's directory and the origins it hides, for messages about a later deep-check failure. */
function winnerShadowsByDir(found: FoundCandidates): ReadonlyMap<string, ReadonlyArray<Origin>> {
  const byDir = new Map<string, ReadonlyArray<Origin>>();
  for (const [winner, ...hidden] of found.values()) {
    if (!winner) continue;
    const { candidate } = winner;
    const dir = candidate._tag === "Entry" ? candidate.entry.dir : candidate.rejection.rejected.dir;
    byDir.set(dir, hiddenOrigins(hidden));
  }
  return byDir;
}

function bundledOnly(found: FoundCandidates): FoundCandidates {
  return new Map(
    [...found].map(([key, candidates]) => [
      key,
      candidates.filter(({ root }) => root.origin === "bundled"),
    ]),
  );
}

function rejectedWithShadows(
  problem: Rejection,
  item: Entry | RejectedEntry,
  winnerShadows: ReadonlyMap<string, ReadonlyArray<Origin>>,
): RejectedEntry {
  const shadows = "shadows" in item ? item.shadows : (winnerShadows.get(item.dir) ?? []);
  return { ...problem.rejected, error: `${problem.rejected.error}${hidesText(shadows)}` };
}

const findRejection = (items: ReadonlyArray<Entry | Rejection>, kind: Kind, id: string) =>
  items.find(
    (candidate): candidate is Rejection =>
      "rejected" in candidate && candidate.rejected.id === id && candidate.rejected.kind === kind,
  );

/** The typed failure for asking for a rejected entry: unreadable is `PermissionDenied`. */
function rejectionError(item: Rejection, id: string, path: Path.Path) {
  const { rejected, reason } = item;
  if (reason === "unreadable")
    return new PermissionDenied({
      details: { reason: "read", path: path.join(rejected.dir, item.path ?? ".") },
    });
  return new EntryInvalid({
    details: {
      id,
      origin: rejected.origin,
      reason,
      ...(item.path === undefined ? {} : { path: item.path }),
    },
  });
}

/** The bundled root's catalog rows, with a rejected entry's id and kind and no tags. */
const bundledCatalog = (bundled: ReadonlyArray<Entry | Rejection>): Array<CatalogEntry> =>
  bundled.map((item) => ({
    id: "rejected" in item ? item.rejected.id : item.id,
    kind: "rejected" in item ? item.rejected.kind : item.kind,
    origin: "bundled" as const,
    tags: "rejected" in item ? [] : item.meta.tags,
    rejected: "rejected" in item,
  }));

const findBundled = (bundled: ReadonlyArray<Entry | Rejection>, kind: Kind, id: string) =>
  bundled.find((candidate) =>
    "rejected" in candidate
      ? candidate.rejected.kind === kind && candidate.rejected.id === id
      : candidate.kind === kind && candidate.id === id,
  );

export class Registry extends Context.Service<
  Registry,
  {
    /** Preliminary names and tags; use `get` or `all` before reporting an entry as usable. */
    readonly catalog: Effect.Effect<ReadonlyArray<CatalogEntry>, PermissionDenied>;
    /** Every winning entry and every rejected one: stacks first, then fragments, each by id. */
    readonly all: Effect.Effect<ReadonlyArray<Entry | RejectedEntry>, PermissionDenied>;
    /** What loading skipped, in load order; `validate` reports it. */
    readonly skipped: Effect.Effect<ReadonlyArray<Skipped>, PermissionDenied>;
    /** An unreadable entry is `PermissionDenied`; any other rejected one is `EntryInvalid`. */
    readonly get: (
      kind: Kind,
      id: string,
    ) => Effect.Effect<Entry, NotFound | EntryInvalid | PermissionDenied>;
    /** Bundled-only names and lookup for comparing bundled run evidence. */
    readonly bundled: Effect.Effect<
      {
        readonly catalog: Effect.Effect<ReadonlyArray<CatalogEntry>, PermissionDenied>;
        readonly metadata: ReadonlyMap<string, Entry["meta"]>;
        readonly get: (
          kind: Kind,
          id: string,
        ) => Effect.Effect<Entry, NotFound | EntryInvalid | PermissionDenied>;
      },
      PermissionDenied
    >;
    readonly vocabulary: Effect.Effect<Uint8Array | undefined, PermissionDenied>;
    /** Dependency files from the bundled root only, each read once per invocation. */
    readonly dependencyCards: Effect.Effect<ReadonlyMap<Ecosystem, Uint8Array>, PermissionDenied>;
    /**
     * The bundled root's `authors.json`, read once per invocation; empty when it is absent or
     * invalid (`validate` reports an invalid one).
     */
    readonly authors: Effect.Effect<AuthorsFile, PermissionDenied>;
    /** Raw sidecar of this entry's own origin, never a higher or lower root's card. */
    readonly search: (entry: Entry) => Effect.Effect<Uint8Array | undefined, PermissionDenied>;
    /** `files/` and `adapters/` of an entry, sorted by `source`. */
    readonly files: (
      entry: Entry,
    ) => Effect.Effect<ReadonlyArray<EntryFile>, EntryInvalid | PermissionDenied>;
    /** Complete entry tree, including empty directories and author notes, for working copies. */
    readonly tree: (entry: Entry) => Effect.Effect<
      {
        directories: ReadonlyArray<string>;
        files: ReadonlyArray<{ source: string; mode: number }>;
      },
      EntryInvalid | PermissionDenied
    >;
    /** Read text by entry-relative source through `readEntryFile`. */
    readonly read: (
      entry: Entry,
      source: string,
    ) => Effect.Effect<string, EntryInvalid | PermissionDenied>;
    /** `read`, as raw bytes: what `new` copies, byte for byte. */
    readonly bytes: (
      entry: Entry,
      source: string,
    ) => Effect.Effect<Uint8Array, EntryInvalid | PermissionDenied>;
  }
>()("stacks/Registry") {
  static layer = (roots: RegistryRoots) =>
    Layer.effect(
      Registry,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const io: FileAccess = { fs, path };
        // Filled while `load` runs; read only after it has.
        const state: LoadState = { io, skipped: [], checks: new Map() };

        const load = Effect.gen(function* () {
          const found = new Map<string, RootCandidate[]>();
          for (const root of roots) yield* loadRoot(root, state, found);
          return {
            winners: registryWinners(found),
            bundled: registryWinners(bundledOnly(found)),
            winnerShadows: winnerShadowsByDir(found),
          };
        });
        const local = yield* Effect.cached(load);

        const view = yield* Effect.cached(
          Effect.gen(function* () {
            const { winners, bundled } = yield* local;
            return yield* remoteRegistry(
              winners.map((item) => ("rejected" in item ? item.rejected : item)),
              bundled.filter((item): item is Entry => !("rejected" in item)),
              roots.some((root) => root.remote),
            ).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            );
          }),
        );

        const deepCheck = (dir: string) => state.checks.get(dir) ?? Effect.succeed(undefined);

        // Keep hidden origins in the rejection if a preliminary winner's deep check fails.
        const checkedItem = (item: Entry | RejectedEntry) =>
          Effect.gen(function* () {
            const problem = yield* deepCheck(item.dir);
            if (!problem) return item;
            return rejectedWithShadows(problem, item, (yield* local).winnerShadows);
          });

        const loadedRejection = (item: RejectedEntry, kind: Kind, id: string) =>
          Effect.gen(function* () {
            const rejected = findRejection((yield* local).winners, kind, id);
            if (rejected) return yield* rejectionError(rejected, id, path);
            return yield* new EntryInvalid({
              details: { id, origin: item.origin, reason: "decode" },
            });
          });

        const checkedGet = (item: Entry | RejectedEntry | undefined, kind: Kind, id: string) =>
          Effect.gen(function* () {
            if (!item) return yield* new NotFound({ details: { suggestions: [], id, kind } });
            const problem = yield* deepCheck(item.dir);
            if (problem) return yield* rejectionError(problem, id, path);
            if (!("error" in item)) return item;
            return yield* loadedRejection(item, kind, id);
          });

        /** Surface cached deep-check failures before a caller reads an entry it already holds. */
        const checkEntry = (entry: Entry) =>
          Effect.gen(function* () {
            const problem = yield* deepCheck(entry.dir);
            if (problem) return yield* rejectionError(problem, entry.id, path);
          });

        const bundledGet = (bundled: ReadonlyArray<Entry | Rejection>, kind: Kind, id: string) => {
          const item = findBundled(bundled, kind, id);
          if (item && "rejected" in item)
            return Effect.gen(function* () {
              const problem = yield* deepCheck(item.rejected.dir);
              return yield* rejectionError(problem ?? item, id, path);
            });
          return checkedGet(item, kind, id);
        };

        const readSearch = (root: string, rel: string) =>
          readSearchFile(root, rel).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          );
        // Vocabulary, dependency cards and authors come from the bundled root only.
        const bundledRootPath = roots.find((root) => root.origin === "bundled")?.path;
        const vocabulary = yield* Effect.cached(
          bundledRootPath === undefined
            ? Effect.succeed(undefined)
            : readSearch(bundledRootPath, "search/vocabulary.json"),
        );
        const dependencyCards = yield* Effect.cached(
          Effect.gen(function* () {
            const cards = new Map<Ecosystem, Uint8Array>();
            if (bundledRootPath === undefined) return cards;
            for (const ecosystem of Ecosystem.literals) {
              const bytes = yield* readSearch(bundledRootPath, `deps/${ecosystem}.json`);
              if (bytes !== undefined) cards.set(ecosystem, bytes);
            }
            return cards;
          }),
        );
        const authors = yield* Effect.cached(
          Effect.gen(function* () {
            if (bundledRootPath === undefined) return {};
            const bytes = yield* readSearch(bundledRootPath, "authors.json");
            if (bytes === undefined) return {};
            return yield* decodeAuthors(bytes).pipe(Effect.orElseSucceed(() => ({})));
          }),
        );

        return {
          vocabulary,
          dependencyCards,
          authors,
          search: (entry) => readSearch(path.dirname(path.dirname(entry.dir)), sidecarPath(entry)),
          all: view.pipe(
            Effect.flatMap((registry) => registry.all),
            Effect.flatMap((items) => Effect.forEach(items, checkedItem)),
          ),
          catalog: view.pipe(Effect.map((registry) => registry.catalog)),
          bundled: local.pipe(
            Effect.map(({ bundled }) => ({
              metadata: new Map(
                bundled
                  .filter((item): item is Entry => !("rejected" in item))
                  .map((item) => [`${item.kind}/${item.id}`, item.meta]),
              ),
              catalog: Effect.succeed(bundledCatalog(bundled)),
              get: (kind: Kind, id: string) => bundledGet(bundled, kind, id),
            })),
          ),
          skipped: local.pipe(Effect.map(() => [...state.skipped])),
          get: (kind, id) =>
            Effect.gen(function* () {
              const item = yield* (yield* view).get(kind, id);
              return yield* checkedGet(item, kind, id);
            }),
          files: (entry) =>
            Effect.gen(function* () {
              yield* checkEntry(entry);
              const walked = yield* entryTree(io, entry);
              return shippedFiles(entry, walked.files);
            }),
          tree: (entry) => checkEntry(entry).pipe(Effect.flatMap(() => entryTree(io, entry))),
          read: (entry, source) =>
            checkEntry(entry).pipe(
              Effect.flatMap(() =>
                readEntryFile(io, entry, source, (file) => fs.readFileString(file)),
              ),
            ),
          bytes: (entry, source) =>
            checkEntry(entry).pipe(
              Effect.flatMap(() => readEntryFile(io, entry, source, (file) => fs.readFile(file))),
            ),
        };
      }),
    );
}
