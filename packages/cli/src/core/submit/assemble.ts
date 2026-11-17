/**
 * Assembles a proposed registry update in the temporary clone so it can be checked as it would
 * appear upstream.
 */
import { AuthorsFile, authorKey, Kind, type SearchMetadata } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, type PlatformError, Predicate, Result, Schema } from "effect";
import { BadInput, PermissionDenied, UpstreamUnavailable } from "../../errors";
import { Registry } from "../registry/registry";
import { searchSourceDigest } from "../search/digest";
import { decodeSidecar, readSearchFile, sidecarPath } from "../search/sidecar";
import { kindDir, type SubmittedEntry } from "./entries";
import { writePermission } from "./filesystem";

export const REGISTRY_PATH = "packages/cli/registry";
export const AUTHORS_FILE = "authors.json";

export type PlannedEntry = SubmittedEntry & { update: boolean };

/** `removed.json`: only the kind of each removed id matters here. */
const RemovedFile = Schema.fromJsonString(
  Schema.Struct({ entries: Schema.Record(Schema.String, Schema.Struct({ kind: Kind })) }),
);
type Removed = typeof RemovedFile.Type;

const upstreamBroken = () =>
  new UpstreamUnavailable({ details: { service: "github", step: "clone" } });

/** A JSON file in the clone's registry, decoded; absent is `fallback`. */
const readUpstream = <A>(file: string, schema: Schema.Codec<A, string>, fallback: A) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return fallback;
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(upstreamBroken));
    return yield* Schema.decodeUnknownEffect(schema)(text).pipe(Effect.mapError(upstreamBroken));
  });

const wasRemoved = (removed: Removed, entry: SubmittedEntry) =>
  Object.hasOwn(removed.entries, entry.id) && removed.entries[entry.id]?.kind === entry.kind;

const ownerOf = (authors: AuthorsFile, entry: SubmittedEntry) => {
  const key = authorKey(entry.kind, entry.id);
  return Object.hasOwn(authors, key) ? authors[key] : undefined;
};

/**
 * Removed ids cannot be reused. An existing id is an update only for the login recorded in
 * `authors.json`.
 */
const planEntries = Effect.fn("submit.planEntries")(function* (options: {
  registry: string;
  entries: ReadonlyArray<SubmittedEntry>;
  login: string;
  authors: AuthorsFile;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const removed = yield* readUpstream(path.join(options.registry, "removed.json"), RemovedFile, {
    entries: {},
  });
  const planned: PlannedEntry[] = [];
  for (const entry of options.entries) {
    const target = path.join(options.registry, kindDir(entry.kind), entry.id);
    const exists = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false));
    const gone = wasRemoved(removed, entry);
    const owner = ownerOf(options.authors, entry);
    if (gone || (exists && owner !== options.login))
      return yield* new BadInput({
        details: {
          flag: "collision",
          kind: entry.kind,
          id: entry.id,
          removed: gone && !exists,
          ...(owner === undefined ? {} : { owner }),
        },
      });
    planned.push({ ...entry, update: exists });
  }
  return planned;
});

/**
 * The source path a failed copy names, or `entryDir` when it names none or one outside the entry.
 * Node copy errors name the source in `cause.path` for both read and write failures.
 */
const sourceCopyPath = (error: PlatformError.PlatformError, entryDir: string, path: Path.Path) => {
  const cause =
    error.reason._tag === "PermissionDenied" || error.reason._tag === "NotFound"
      ? error.reason.cause
      : undefined;
  const reported =
    typeof cause === "object" && cause !== null && "path" in cause && typeof cause.path === "string"
      ? cause.path
      : entryDir;
  const relative = path.relative(entryDir, reported);
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    ? reported
    : entryDir;
};

const readUnavailable = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "PermissionDenied";

/**
 * Node gives the source path for either copy failure. Check its read access to distinguish an entry
 * read denial from a clone write denial.
 */
const copyFailure = Effect.fn("submit.copyFailure")(function* (
  error: PlatformError.PlatformError,
  entry: PlannedEntry,
  target: string,
) {
  if (!readUnavailable(error)) return yield* Effect.die(error);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const access = yield* Effect.result(
    fs.access(sourceCopyPath(error, entry.dir, path), { readable: true }),
  );
  if (Result.isFailure(access)) {
    if (readUnavailable(access.failure))
      return yield* new PermissionDenied({ details: { reason: "read", path: entry.dir } });
    return yield* Effect.die(access.failure);
  }
  if (error.reason._tag === "PermissionDenied")
    return yield* new PermissionDenied({ details: { reason: "write", path: target } });
  return yield* Effect.die(error);
});

const copyEntry = Effect.fn("submit.copyEntry")(function* (registry: string, entry: PlannedEntry) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(registry, kindDir(entry.kind), entry.id);
  yield* writePermission(fs.remove(target, { recursive: true, force: true }), target);
  yield* writePermission(
    fs.makeDirectory(path.dirname(target), { recursive: true }),
    path.dirname(target),
  );
  yield* fs
    .copy(entry.dir, target)
    .pipe(Effect.catchTag("PlatformError", (error) => copyFailure(error, entry, target)));
});

/**
 * The card as it should go upstream for an entry whose current digest is `digest`. An author's
 * unreviewed draft is restamped as it is. A reviewed (or maintainer-drafted) card that still
 * matches is left alone; one that no longer matches is restamped and becomes the author's
 * unreviewed draft, which maintainers review again (`search-unreviewed`) instead of a
 * `search-stale` that would block the submission. `undefined` means leave the card unchanged.
 */
function freshCard(raw: Record<string, unknown>, card: SearchMetadata, digest: string) {
  const source = Predicate.isObject(raw.source) ? raw.source : {};
  if (card.source.by === "author" && card.source.reviewedAt === null)
    return { ...raw, source: { ...source, digest } };
  if (card.source.digest === digest) return undefined;
  return { ...raw, source: { ...source, digest, by: "author", reviewedAt: null } };
}

/** Defer malformed cards and entries to the submission checks if they cannot be restamped. */
const restampedCard = Effect.fn("submit.restampedCard")(function* (
  entry: PlannedEntry,
  bytes: Uint8Array,
) {
  const loaded = yield* Effect.result((yield* Registry).get(entry.kind, entry.id));
  const decoded = yield* Effect.result(decodeSidecar(bytes));
  const raw = Result.try(() => JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  if (Result.isFailure(loaded) || Result.isFailure(decoded) || Result.isFailure(raw)) return;
  if (!Predicate.isObject(raw.success)) return;
  return freshCard(raw.success, decoded.success, searchSourceDigest(loaded.success));
});

/**
 * Reuse the upstream card on updates that bring none, then restamp it against the submitted entry.
 */
const copyCard = Effect.fn("submit.copyCard")(function* (registry: string, entry: PlannedEntry) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const card = sidecarPath(entry);
  const target = path.join(registry, card);
  const io = { fs, path };
  const own = yield* readSearchFile(io, entry.root, card);
  const bytes =
    own ?? (yield* readSearchFile(io, registry, card).pipe(Effect.orElseSucceed(() => undefined)));
  if (bytes === undefined) return;
  yield* writePermission(
    fs.makeDirectory(path.dirname(target), { recursive: true }),
    path.dirname(target),
  );
  const fresh = yield* restampedCard(entry, bytes);
  // If a supplied card cannot be restamped, keep its bytes so submission checks report it.
  if (fresh !== undefined)
    yield* writePermission(
      fs.writeFileString(target, `${JSON.stringify(fresh, null, 2)}\n`),
      target,
    );
  else if (own !== undefined) yield* writePermission(fs.writeFile(target, own), target);
});

/** `authors` with every planned entry given to `login`, sorted by key for a stable file. */
const nextAuthors = (authors: AuthorsFile, planned: ReadonlyArray<PlannedEntry>, login: string) => {
  const next: Record<string, string> = { ...authors };
  for (const entry of planned) next[authorKey(entry.kind, entry.id)] = login;
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
};

export const assemble = Effect.fn("submit.assemble")(function* (options: {
  registry: string;
  entries: ReadonlyArray<SubmittedEntry>;
  login: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const authorsPath = path.join(options.registry, AUTHORS_FILE);
  const authors = yield* readUpstream(authorsPath, Schema.fromJsonString(AuthorsFile), {});
  const planned = yield* planEntries({ ...options, authors });
  for (const entry of planned) yield* copyEntry(options.registry, entry);
  // Cards are restamped against the entries as copied, so the registry reads the clone.
  yield* Effect.gen(function* () {
    for (const entry of planned) yield* copyCard(options.registry, entry);
  }).pipe(Effect.provide(Registry.layer([{ origin: "bundled", path: options.registry }])));
  const sorted = nextAuthors(authors, planned, options.login);
  yield* writePermission(
    fs.writeFileString(authorsPath, `${JSON.stringify(sorted, null, 2)}\n`),
    authorsPath,
  );
  return planned;
});
