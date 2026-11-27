/**
 * Resolves entries by registry precedence, with trust inherited from `localRoot` or `indexRoot`.
 * Per-invocation caching keeps catalog reads cheap and deep checks lazy and per-entry.
 */
import { type AuthorsFile, Ecosystem, type Kind } from "@steamfield/stacks-format";
import { Context, Effect, FileSystem, Layer, Option, Path, Scope } from "effect";
import { EntryInvalid, NotFound, type PermissionDenied } from "../../errors";
import { denied } from "../fs/denied";
import { defined } from "../object";
import { decodeAuthors, readSearchFile, sidecarPath } from "../search/sidecar";
import {
  type CatalogEntry,
  catalogRow,
  compareEntries,
  type Entry,
  type EntryFile,
  entryKey,
  isRejected,
  type Origin,
  type RegistryEntry,
  type RejectedEntry,
} from "./entry";
import { type LoadState, loadRoot } from "./load";
import { remoteRegistry } from "./remote/merge";
import { RemoteIndex } from "./remote/service";
import { localRoot, type RegistryRoots } from "./roots";
import { entryTree, readEntryFile, shippedFiles } from "./tree";
import type { FileAccess, Skipped } from "./types";

export type { Skipped } from "./types";

/** Candidates per `kind/id`, in root order: the first is the winner, the rest it hides. */
type FoundCandidates = ReadonlyMap<string, ReadonlyArray<RegistryEntry>>;

function hidesText(shadows: ReadonlyArray<Origin>): string {
  if (!shadows.length) return "";
  return `; hides ${shadows.join(" and ")} cop${shadows.length > 1 ? "ies" : "y"}`;
}

/** Keep shadow origins in root order so rejection messages reflect precedence. */
const hiddenOrigins = (hidden: ReadonlyArray<RegistryEntry>) => [
  ...new Set(hidden.map(({ origin }) => origin)),
];

/** Sort stacks before fragments, then by id. A rejected winner still hides lower-priority copies. */
function registryWinners(found: FoundCandidates) {
  const results: Array<[string, RegistryEntry]> = [];
  for (const [key, [winner, ...hidden]] of found) {
    if (!winner) continue;
    const shadows = hiddenOrigins(hidden);
    results.push([
      key,
      isRejected(winner)
        ? { ...winner, error: `${winner.error}${hidesText(shadows)}` }
        : { ...winner, shadows },
    ]);
  }
  return new Map(results.sort(([, a], [, b]) => compareEntries(a, b)));
}

/** Each winner's directory and the origins it hides, for messages about a later deep-check failure. */
function winnerShadowsByDir(found: FoundCandidates): ReadonlyMap<string, ReadonlyArray<Origin>> {
  const byDir = new Map<string, ReadonlyArray<Origin>>();
  for (const [winner, ...hidden] of found.values()) {
    if (!winner) continue;
    byDir.set(winner.dir, hiddenOrigins(hidden));
  }
  return byDir;
}

function bundledOnly(found: FoundCandidates): FoundCandidates {
  return new Map(
    [...found].map(([key, candidates]) => [
      key,
      candidates.filter(({ origin }) => origin === "bundled"),
    ]),
  );
}

function rejectedWithShadows(
  problem: RejectedEntry,
  item: RegistryEntry,
  winnerShadows: ReadonlyMap<string, ReadonlyArray<Origin>>,
): RejectedEntry {
  const shadows = isRejected(item) ? (winnerShadows.get(item.dir) ?? []) : item.shadows;
  return { ...problem, error: `${problem.error}${hidesText(shadows)}` };
}

/** The typed failure for asking for a rejected entry: unreadable is `PermissionDenied`. */
function rejectionError({ path }: FileAccess, item: RejectedEntry, id: string) {
  const { reason } = item;
  if (reason === "unreadable") return denied("read", path.join(item.dir, item.path ?? "."));
  return new EntryInvalid({
    details: defined({
      id,
      origin: item.origin,
      reason,
      path: item.path,
    }),
  });
}

function localRegistry(winners: ReadonlyMap<string, RegistryEntry>) {
  return {
    catalog: Effect.sync(() => Array.from(winners.values(), catalogRow)),
    all: Effect.sync(() => [...winners.values()]),
    get: (kind: Kind, id: string) => Effect.succeed(winners.get(entryKey(kind, id))),
  };
}

export class Registry extends Context.Service<
  Registry,
  {
    /** Preliminary names and tags; use `get` or `all` before reporting an entry as usable. */
    readonly catalog: Effect.Effect<ReadonlyArray<CatalogEntry>, PermissionDenied>;
    /** Every winning entry and every rejected one: stacks first, then fragments, each by id. */
    readonly all: Effect.Effect<ReadonlyArray<RegistryEntry>, PermissionDenied>;
    /** What loading skipped, in load order; `validate` reports it. */
    readonly skipped: Effect.Effect<ReadonlyArray<Skipped>, PermissionDenied>;
    /** An unreadable entry is `PermissionDenied`; any other rejected one is `EntryInvalid`. */
    readonly get: (
      kind: Kind,
      id: string,
    ) => Effect.Effect<Entry, NotFound | EntryInvalid | PermissionDenied>;
    /** Bundled-only names and lookup for comparing bundled run evidence. */
    readonly bundledLookup: Effect.Effect<
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
        const scope = yield* Scope.Scope;
        const io: FileAccess = { fs, path };
        // Filled while `load` runs; read only after it has.
        const state: LoadState = { io, skipped: [], treeChecks: new Map() };

        const localRoots = roots.map(localRoot);
        const load = Effect.gen(function* () {
          const found = new Map<string, RegistryEntry[]>();
          for (const root of localRoots) yield* loadRoot(root, state, found);
          return {
            winners: registryWinners(found),
            bundledWinners: registryWinners(bundledOnly(found)),
            winnerShadows: winnerShadowsByDir(found),
          };
        });
        const local = yield* Effect.cached(load);

        const index = roots.some((root) => root.remote)
          ? yield* Effect.serviceOption(RemoteIndex)
          : Option.none();
        const view = yield* Effect.cached(
          Effect.gen(function* () {
            const { winners, bundledWinners } = yield* local;
            if (Option.isNone(index) || index.value.root === undefined)
              return localRegistry(winners);
            return yield* remoteRegistry(io, index.value, winners, {
              bundledEntries: [...bundledWinners.values()].filter((item) => !isRejected(item)),
              scope,
            });
          }),
        );

        const treeRejection = (dir: string) =>
          state.treeChecks.get(dir) ?? Effect.succeed(undefined);

        // Keep hidden origins in the rejection if a preliminary winner's deep check fails.
        const checkedItem = Effect.fnUntraced(function* (item: RegistryEntry) {
          const problem = yield* treeRejection(item.dir);
          if (!problem) return item;
          return rejectedWithShadows(problem, item, (yield* local).winnerShadows);
        });

        const checkedGet = Effect.fnUntraced(function* (
          item: RegistryEntry | undefined,
          kind: Kind,
          id: string,
        ) {
          if (!item) return yield* new NotFound({ details: { suggestions: [], id, kind } });
          const problem = yield* treeRejection(item.dir);
          if (problem) return yield* rejectionError(io, problem, id);
          if (isRejected(item)) return yield* rejectionError(io, item, id);
          return item;
        });

        /** Surface cached deep-check failures before a caller reads an entry it already holds. */
        const checkEntry = (entry: Entry) =>
          Effect.gen(function* () {
            const problem = yield* treeRejection(entry.dir);
            if (problem) return yield* rejectionError(io, problem, entry.id);
          });

        // Vocabulary, dependency cards and authors come from the bundled root only.
        const bundledRootPath = roots.find((root) => root.origin === "bundled")?.path;
        const vocabulary = yield* Effect.cached(
          bundledRootPath === undefined
            ? Effect.succeed(undefined)
            : readSearchFile(io, bundledRootPath, "search/vocabulary.json"),
        );
        const dependencyCards = yield* Effect.cached(
          Effect.gen(function* () {
            const cards = new Map<Ecosystem, Uint8Array>();
            if (bundledRootPath === undefined) return cards;
            for (const ecosystem of Ecosystem.literals) {
              const bytes = yield* readSearchFile(io, bundledRootPath, `deps/${ecosystem}.json`);
              if (bytes !== undefined) cards.set(ecosystem, bytes);
            }
            return cards;
          }),
        );
        const authors = yield* Effect.cached(
          Effect.gen(function* () {
            if (bundledRootPath === undefined) return {};
            const bytes = yield* readSearchFile(io, bundledRootPath, "authors.json");
            if (bytes === undefined) return {};
            return yield* decodeAuthors(bytes).pipe(Effect.orElseSucceed(() => ({})));
          }),
        );

        return {
          vocabulary,
          dependencyCards,
          authors,
          search: (entry) =>
            readSearchFile(io, path.dirname(path.dirname(entry.dir)), sidecarPath(entry)),
          all: view.pipe(
            Effect.flatMap((registry) => registry.all),
            Effect.flatMap((items) => Effect.forEach(items, checkedItem)),
          ),
          catalog: yield* Effect.cached(view.pipe(Effect.flatMap((registry) => registry.catalog))),
          bundledLookup: local.pipe(
            Effect.map(({ bundledWinners }) => ({
              metadata: new Map(
                [...bundledWinners].flatMap(([key, item]) =>
                  isRejected(item) ? [] : [[key, item.meta]],
                ),
              ),
              catalog: Effect.sync(() => Array.from(bundledWinners.values(), catalogRow)),
              get: (kind: Kind, id: string) =>
                checkedGet(bundledWinners.get(entryKey(kind, id)), kind, id),
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
