import { type AuthorsFile, Ecosystem, type Kind } from "@steamfield/stacks-format";
import { Context, Effect, FileSystem, Layer, Path, type PlatformError } from "effect";
import { AppConfig } from "../../config";
import { EntryInvalid, NotFound, PermissionDenied } from "../../errors";
import { METADATA_DIR } from "../../project-layout";
import { Host } from "../../services/host";
import { decodeAuthors, readSearchFile, sidecarPath } from "../search/sidecar";
import { printable } from "../text";
import {
  type CatalogEntry,
  decodeEntry,
  type Entry,
  type EntryFile,
  markdownFile,
  type Origin,
  type RejectedEntry,
} from "./entry";
import { remoteRegistry } from "./remote";

/**
 * One registry root. `overridden` marks a bundled root set by STACKS_REGISTRY_DIR instead of
 * the one shipped with the CLI, whose entries are untrusted.
 */
export type RegistryRoot = { origin: Origin; path: string; overridden?: boolean; remote?: boolean };
/** Registry roots, highest precedence first. */
export type RegistryRoots = ReadonlyArray<RegistryRoot>;
type Reason = "decode" | "symlink" | "id_mismatch" | "missing" | "unreadable";
/** A rejected entry plus what `get` needs to report it. */
type Rejection = { rejected: RejectedEntry; reason: Reason; path?: string };
type Found = Omit<Entry, "shadows" | "trusted">;
/**
 * What loading passed over without an entry or a rejection: an entry whose `schema_version` is
 * newer than this CLI reads (a lower origin's copy may win instead), or a project root or its
 * `stacks/` or `fragments/` that is a symlink, with everything under it.
 */
export type Skipped =
  | { reason: "newer"; origin: Origin; kind: Kind; id: string; dir: string; version: number }
  | { reason: "symlink"; origin: Origin; dir: string };
type Candidate = { _tag: "Entry"; entry: Found } | { _tag: "Rejected"; rejection: Rejection };
type DecodedCandidate = Candidate | { _tag: "Newer"; version: number };
type CandidateInput = { origin: Origin; kind: Kind; dir: string; id: string };
const rejectCandidate = (
  { origin, kind, dir, id }: CandidateInput,
  reason: Reason,
  error: string,
  at?: string,
): Extract<Candidate, { _tag: "Rejected" }> => ({
  _tag: "Rejected",
  rejection: {
    rejected: { id, kind, origin, dir, error },
    reason,
    ...(at === undefined ? {} : { path: at }),
  },
});

const decodeCandidate = (input: CandidateInput, text: string) =>
  Effect.gen(function* () {
    const { origin, kind, dir, id } = input;
    const file = markdownFile(kind);
    const decoded = yield* decodeEntry(kind, text);
    switch (decoded._tag) {
      case "Newer":
        return { _tag: "Newer" as const, version: decoded.version };
      case "Invalid":
        return rejectCandidate(input, "decode", decoded.error, file);
      case "Meta":
        if (decoded.meta.id !== id)
          return rejectCandidate(
            input,
            "id_mismatch",
            `id: ${JSON.stringify(decoded.meta.id)} must equal the directory name ${JSON.stringify(id)}`,
            file,
          );
        return {
          _tag: "Entry" as const,
          entry: { id, kind, origin, dir, meta: decoded.meta, body: decoded.body },
        };
    }
  });

const readCandidate = (input: CandidateInput, fs: FileSystem.FileSystem, path: Path.Path) =>
  Effect.gen(function* () {
    const file = markdownFile(input.kind);
    const at = path.join(input.dir, file);
    const failed = (error: PlatformError.PlatformError) =>
      notFound(error)
        ? rejectCandidate(input, "missing", `${file} is missing`, file)
        : rejectCandidate(input, "unreadable", `${file} is unreadable`, file);
    const markdown = yield* Effect.result(fs.lstat(at));
    if (markdown._tag === "Failure") return failed(markdown.failure);
    if (markdown.success.type === "SymbolicLink")
      return rejectCandidate(input, "symlink", `symlink: ${file}`, file);
    if (markdown.success.type !== "File")
      return rejectCandidate(input, "unreadable", `${file} is unreadable`, file);
    const text = yield* Effect.result(fs.readFileString(at));
    if (text._tag === "Failure") return failed(text.failure);
    return yield* decodeCandidate(input, text.success);
  });

const checkCandidateTree = (input: CandidateInput, fs: FileSystem.FileSystem, path: Path.Path) =>
  Effect.gen(function* () {
    const walked = yield* Effect.result(walkEntry(fs, path, input.dir));
    if (walked._tag === "Failure")
      return rejectCandidate(input, "unreadable", "the entry directory is unreadable", ".")
        .rejection;
    if (walked.success._tag === "Link")
      return rejectCandidate(input, "symlink", `symlink: ${walked.success.rel}`, walked.success.rel)
        .rejection;
    return undefined;
  });

const loadedCandidate = (
  input: CandidateInput,
  options: {
    fs: FileSystem.FileSystem;
    path: Path.Path;
    skipped: Skipped[];
    checks: Map<string, Effect.Effect<Rejection | undefined>>;
  },
) =>
  Effect.gen(function* () {
    const { fs, path, skipped, checks } = options;
    const check = yield* Effect.cached(checkCandidateTree(input, fs, path));
    checks.set(input.dir, check);
    const loaded: DecodedCandidate = yield* readCandidate(input, fs, path);
    if (loaded._tag !== "Newer") return loaded;
    const problem = yield* check;
    if (problem) return { _tag: "Rejected" as const, rejection: problem };
    const { origin, kind, id, dir } = input;
    yield* Effect.logWarning(
      `Skipped ${origin} ${kind} ${printable(id)}: schema_version ${loaded.version} is newer than this CLI reads`,
    );
    skipped.push({ reason: "newer", origin, kind, id, dir, version: loaded.version });
    return undefined;
  });
/** Every regular file under a directory, or the first symlink met (nothing past it is read). */
type Walked =
  | {
      _tag: "Files";
      files: ReadonlyArray<{ rel: string; mode: number }>;
      directories: ReadonlyArray<string>;
    }
  | { _tag: "Link"; rel: string };

type RootCandidate = { root: RegistryRoot; candidate: Candidate };

function collectWinnerShadows(
  found: ReadonlyMap<string, ReadonlyArray<RootCandidate>>,
  into: Map<string, ReadonlyArray<Origin>>,
) {
  for (const candidates of found.values()) {
    const [winner, ...hidden] = candidates;
    if (!winner) continue;
    const dir =
      winner.candidate._tag === "Entry"
        ? winner.candidate.entry.dir
        : winner.candidate.rejection.rejected.dir;
    into.set(dir, [...new Set(hidden.map(({ root }) => root.origin))]);
  }
}

function rejectedWithShadows(
  problem: Rejection,
  item: Entry | RejectedEntry,
  winnerShadows: ReadonlyMap<string, ReadonlyArray<Origin>>,
): RejectedEntry {
  const shadows = "shadows" in item ? item.shadows : (winnerShadows.get(item.dir) ?? []);
  const hides = shadows.length
    ? `; hides ${shadows.join(" and ")} cop${shadows.length > 1 ? "ies" : "y"}`
    : "";
  return { ...problem.rejected, error: `${problem.rejected.error}${hides}` };
}

const findRejection = (items: ReadonlyArray<Entry | Rejection>, kind: Kind, id: string) =>
  items.find(
    (candidate): candidate is Rejection =>
      "rejected" in candidate && candidate.rejected.id === id && candidate.rejected.kind === kind,
  );

function registryWinners(found: ReadonlyMap<string, ReadonlyArray<RootCandidate>>) {
  const results: Array<Entry | Rejection> = [];
  for (const [winner, ...hidden] of found.values()) {
    if (!winner) continue;
    const shadows = [...new Set(hidden.map(({ root }) => root.origin))];
    const { candidate } = winner;
    if (candidate._tag === "Entry") {
      const entry = { ...candidate.entry, shadows };
      results.push({ ...entry, trusted: trustOf(entry, winner.root) });
    } else {
      const { rejected } = candidate.rejection;
      const hides = shadows.length
        ? `; hides ${shadows.join(" and ")} cop${shadows.length > 1 ? "ies" : "y"}`
        : "";
      results.push({
        ...candidate.rejection,
        rejected: { ...rejected, error: `${rejected.error}${hides}` },
      });
    }
  }
  const key = (value: Entry | Rejection) => ("rejected" in value ? value.rejected : value);
  return results.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x.kind !== y.kind) return x.kind === "stack" ? -1 : 1;
    return x.id < y.id ? -1 : 1;
  });
}

const walkChild = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
  at: string,
): Effect.Effect<Walked, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const info = yield* fs.lstat(path.join(dir, at));
    if (info.type === "SymbolicLink") return { _tag: "Link", rel: at } as const;
    if (info.type === "Directory") {
      const inner = yield* walkEntry(fs, path, dir, at);
      if (inner._tag === "Link") return inner;
      return { ...inner, directories: [at, ...inner.directories] };
    }
    return {
      _tag: "Files",
      directories: [],
      files: info.type === "File" ? [{ rel: at, mode: info.mode & 0o777 }] : [],
    } as const;
  });
/**
 * Regular files under `dir`, depth first by sorted name, stopping at the first symlink.
 * Each name is lstat'ed before anything descends into it, so a link is never followed.
 */
const walkEntry = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
  rel = "",
): Effect.Effect<Walked, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const files: Array<{ rel: string; mode: number }> = [];
    const directories: string[] = [];
    const found = yield* fs.readDirectory(rel ? path.join(dir, rel) : dir);
    for (const name of [...found].sort()) {
      const at = rel ? `${rel}/${name}` : name;
      const child = yield* walkChild(fs, path, dir, at);
      if (child._tag === "Link") return child;
      directories.push(...child.directories);
      files.push(...child.files);
    }
    return { _tag: "Files", files, directories } as const;
  });

const kinds = [
  { kind: "stack", dir: "stacks" },
  { kind: "fragment", dir: "fragments" },
] as const satisfies ReadonlyArray<{ kind: Kind; dir: string }>;

/**
 * Whether an entry is trusted, by origin and root: project entries never are, nor are entries
 * from a bundled root set by STACKS_REGISTRY_DIR; user entries and the shipped bundled ones are
 * (Trust model, point 2).
 */
export function trustOf(entry: Pick<Entry, "origin">, root: RegistryRoot): boolean {
  return entry.origin !== "project" && !root.overridden;
}

const notFound = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "BadResource";

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
    /**
     * The text of one file in an entry, by its entry-relative `source`. Every path segment is
     * lstat'ed first, so a symlink anywhere under the entry is `EntryInvalid` (`symlink`) and
     * nothing behind it is read; a missing file is `EntryInvalid` (`missing`).
     */
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
  /**
   * Symlinks: an entry directory or anything inside one is never followed, in any root. The
   * project root and its `stacks/` and `fragments/` must be real directories too (a warning, and
   * that root or directory is skipped), since a checkout controls them. The user and bundled
   * roots may be symlinks, as may their `stacks/` and `fragments/`: the user put them there, or a
   * package manager linked the install.
   */
  static layer = (roots: RegistryRoots) =>
    Layer.effect(
      Registry,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        /** Names in a directory, sorted; a missing directory is empty. */
        const names = (dir: string) =>
          fs.readDirectory(dir).pipe(
            Effect.map((found) => [...found].sort()),
            Effect.catch((error) =>
              notFound(error)
                ? Effect.succeed<Array<string>>([])
                : Effect.fail(new PermissionDenied({ details: { reason: "read", path: dir } })),
            ),
          );
        /** True when `dir` is a symlink; logs that it was skipped. */
        const linked = (dir: string) =>
          fs.lstat(dir).pipe(
            Effect.map((info) => info.type === "SymbolicLink"),
            Effect.orElseSucceed(() => false),
            Effect.tap((link) =>
              link
                ? Effect.logWarning(
                    `Skipped the project registry at ${printable(dir)}: it is a symlink`,
                  )
                : Effect.void,
            ),
          );
        const walk = (dir: string, rel = "") => walkEntry(fs, path, dir, rel);
        const checks = new Map<string, Effect.Effect<Rejection | undefined>>();
        const winnerShadows = new Map<string, ReadonlyArray<Origin>>();

        const candidate = (origin: Origin, kind: Kind, dir: string, id: string) =>
          Effect.gen(function* () {
            const input = { origin, kind, dir, id };
            const self = yield* Effect.result(fs.lstat(dir));
            if (self._tag === "Failure")
              return rejectCandidate(input, "unreadable", "the entry directory is unreadable", ".");
            if (self.success.type === "SymbolicLink")
              return rejectCandidate(input, "symlink", "the entry directory is a symlink", ".");
            if (self.success.type !== "Directory") return undefined;
            return yield* loadedCandidate(input, { fs, path, skipped, checks });
          });

        const loadKind = (
          root: RegistryRoot,
          kind: Kind,
          dir: string,
          found: Map<string, RootCandidate[]>,
        ) =>
          Effect.gen(function* () {
            const strict = root.origin === "project";
            const parent = path.join(root.path, dir);
            if (strict && (yield* linked(parent))) {
              skipped.push({ reason: "symlink", origin: root.origin, dir: parent });
              return;
            }
            for (const id of yield* names(parent)) {
              const loaded = yield* candidate(root.origin, kind, path.join(parent, id), id);
              if (!loaded) continue;
              const key = `${kind}/${id}`;
              found.set(key, [...(found.get(key) ?? []), { root, candidate: loaded }]);
            }
          });

        const load = Effect.gen(function* () {
          const found = new Map<string, RootCandidate[]>();
          for (const root of roots) {
            const strict = root.origin === "project";
            if (strict && (yield* linked(root.path))) {
              skipped.push({ reason: "symlink", origin: root.origin, dir: root.path });
              continue;
            }
            for (const { kind, dir } of kinds) yield* loadKind(root, kind, dir, found);
          }
          const winners = registryWinners(found);
          collectWinnerShadows(found, winnerShadows);
          const bundled = registryWinners(
            new Map(
              [...found].map(([key, candidates]) => [
                key,
                candidates.filter(({ root }) => root.origin === "bundled"),
              ]),
            ),
          );
          return { winners, bundled };
        });
        /** Filled while `load` runs; read only after it has. */
        const skipped: Skipped[] = [];
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

        /**
         * `lstat`s the entry directory and every prefix of `source` down to the file, so a symlink
         * anywhere is `EntryInvalid` (`symlink`) and nothing behind it is read, then runs `read`.
         */
        const checked = <A>(
          entry: Entry,
          source: string,
          read: (file: string) => Effect.Effect<A, PlatformError.PlatformError>,
        ) =>
          Effect.gen(function* () {
            const invalid = (reason: "symlink" | "missing", at: string) =>
              new EntryInvalid({
                details: { id: entry.id, origin: entry.origin, reason, path: at },
              });
            const denied = (at: string) =>
              new PermissionDenied({ details: { reason: "read", path: at } });
            const segments = source.split("/");
            if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
              return yield* invalid("missing", source);
            for (let depth = 0; depth <= segments.length; depth++) {
              const rel = segments.slice(0, depth).join("/") || ".";
              const at = path.join(entry.dir, rel);
              const info = yield* fs
                .lstat(at)
                .pipe(
                  Effect.mapError((error) =>
                    notFound(error) ? invalid("missing", source) : denied(at),
                  ),
                );
              if (info.type === "SymbolicLink") return yield* invalid("symlink", rel);
            }
            const file = path.join(entry.dir, source);
            return yield* read(file).pipe(
              Effect.mapError((error) =>
                notFound(error) ? invalid("missing", source) : denied(file),
              ),
            );
          });

        const tree = (entry: Entry) =>
          Effect.gen(function* () {
            const walked = yield* walk(entry.dir).pipe(
              Effect.mapError(
                () => new PermissionDenied({ details: { reason: "read", path: entry.dir } }),
              ),
            );
            if (walked._tag === "Link")
              return yield* new EntryInvalid({
                details: {
                  id: entry.id,
                  origin: entry.origin,
                  reason: "symlink",
                  path: walked.rel,
                },
              });
            return {
              directories: walked.directories,
              files: walked.files.map(({ rel, mode }) => ({ source: rel, mode })),
            };
          });

        const rejectionError = (item: Rejection, id: string) => {
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
        };

        const checkedItem = (item: Entry | RejectedEntry) =>
          Effect.gen(function* () {
            const problem = yield* checks.get(item.dir) ?? Effect.succeed(undefined);
            return problem ? rejectedWithShadows(problem, item, winnerShadows) : item;
          });

        const loadedRejection = (item: RejectedEntry, kind: Kind, id: string) =>
          Effect.gen(function* () {
            const rejected = findRejection((yield* local).winners, kind, id);
            if (rejected) return yield* rejectionError(rejected, id);
            return yield* new EntryInvalid({
              details: { id, origin: item.origin, reason: "decode" },
            });
          });

        const checkedGet = (item: Entry | RejectedEntry | undefined, kind: Kind, id: string) =>
          Effect.gen(function* () {
            if (!item) return yield* new NotFound({ details: { suggestions: [], id, kind } });
            const problem = yield* checks.get(item.dir) ?? Effect.succeed(undefined);
            if (problem) return yield* rejectionError(problem, id);
            if (!("error" in item)) return item;
            return yield* loadedRejection(item, kind, id);
          });

        const checkEntry = (entry: Entry) =>
          Effect.gen(function* () {
            const problem = yield* checks.get(entry.dir) ?? Effect.succeed(undefined);
            if (problem) return yield* rejectionError(problem, entry.id);
          });

        const readSearch = (root: string, rel: string) =>
          readSearchFile(root, rel).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          );
        const vocabularyRoot = roots.find((root) => root.origin === "bundled");
        const vocabulary = yield* Effect.cached(
          vocabularyRoot === undefined
            ? Effect.succeed(undefined)
            : readSearch(vocabularyRoot.path, "search/vocabulary.json"),
        );
        const dependencyCards = yield* Effect.cached(
          Effect.gen(function* () {
            const cards = new Map<Ecosystem, Uint8Array>();
            if (vocabularyRoot === undefined) return cards;
            for (const ecosystem of Ecosystem.literals) {
              const bytes = yield* readSearch(vocabularyRoot.path, `deps/${ecosystem}.json`);
              if (bytes !== undefined) cards.set(ecosystem, bytes);
            }
            return cards;
          }),
        );
        const authors = yield* Effect.cached(
          Effect.gen(function* () {
            if (vocabularyRoot === undefined) return {};
            const bytes = yield* readSearch(vocabularyRoot.path, "authors.json");
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
              catalog: Effect.succeed(
                bundled.map((item) => ({
                  id: "rejected" in item ? item.rejected.id : item.id,
                  kind: "rejected" in item ? item.rejected.kind : item.kind,
                  origin: "bundled" as const,
                  tags: "rejected" in item ? [] : item.meta.tags,
                  rejected: "rejected" in item,
                })),
              ),
              get: (kind: Kind, id: string) => {
                const item = bundled.find((candidate) =>
                  "rejected" in candidate
                    ? candidate.rejected.kind === kind && candidate.rejected.id === id
                    : candidate.kind === kind && candidate.id === id,
                );
                if (item && "rejected" in item)
                  return Effect.gen(function* () {
                    const problem = yield* checks.get(item.rejected.dir) ??
                      Effect.succeed(undefined);
                    return yield* rejectionError(problem ?? item, id);
                  });
                return checkedGet(item, kind, id);
              },
            })),
          ),
          skipped: local.pipe(Effect.map(() => [...skipped])),
          get: (kind, id) =>
            Effect.gen(function* () {
              const item = yield* (yield* view).get(kind, id);
              return yield* checkedGet(item, kind, id);
            }),
          files: (entry) =>
            Effect.gen(function* () {
              yield* checkEntry(entry);
              const walked = yield* tree(entry);
              // `files/<path>` and `adapters/<agent>/<path>`; anything else in the entry ships nothing.
              const shipped = /^(?:files|adapters\/[^/]+)\/(.+)$/;
              return walked.files
                .flatMap(({ source, mode }) => {
                  const match = shipped.exec(source);
                  return match?.[1] ? [{ source, path: match[1], mode }] : [];
                })
                .sort((a, b) => (a.source < b.source ? -1 : 1));
            }),
          tree: (entry) => checkEntry(entry).pipe(Effect.flatMap(() => tree(entry))),
          read: (entry, source) =>
            checkEntry(entry).pipe(
              Effect.flatMap(() => checked(entry, source, (file) => fs.readFileString(file))),
            ),
          bytes: (entry, source) =>
            checkEntry(entry).pipe(
              Effect.flatMap(() => checked(entry, source, (file) => fs.readFile(file))),
            ),
        };
      }),
    );
}
