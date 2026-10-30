import { AuthorsFile, authorKey, Kind } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { BadInput, PermissionDenied, UpstreamUnavailable } from "../../errors";
import { Registry } from "../registry/registry";
import { searchSourceDigest } from "../search/digest";
import { decodeSidecar, readSearchFile, sidecarPath } from "../search/sidecar";
import { kindDir, type SubmittedEntry } from "./entries";

/** Where the registry sits in the upstream repository. */
export const REGISTRY_PATH = "packages/cli/registry";
export const AUTHORS_FILE = "authors.json";

export type PlannedEntry = SubmittedEntry & { update: boolean };

/** `removed.json`: only the kind of each removed id matters here. */
const RemovedFile = Schema.fromJsonString(
  Schema.Struct({ entries: Schema.Record(Schema.String, Schema.Struct({ kind: Kind })) }),
);

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

/**
 * Whether each entry is new or an update. An id the upstream registry has, or has removed, is
 * refused unless `authors.json` gives it to this login, which makes the submission an update.
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
    const gone =
      Object.hasOwn(removed.entries, entry.id) && removed.entries[entry.id]?.kind === entry.kind;
    const key = authorKey(entry.kind, entry.id);
    const owner = Object.hasOwn(options.authors, key) ? options.authors[key] : undefined;
    if ((exists || gone) && owner !== options.login)
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

/** Replaces the clone's copy of an entry with the author's directory. */
const copyEntry = Effect.fn("submit.copyEntry")(function* (registry: string, entry: PlannedEntry) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(registry, kindDir(entry.kind), entry.id);
  yield* fs.remove(target, { recursive: true, force: true }).pipe(Effect.orDie);
  yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
  yield* fs
    .copy(entry.dir, target)
    .pipe(
      Effect.mapError(() => new PermissionDenied({ details: { reason: "read", path: entry.dir } })),
    );
});

/**
 * Copies the entry's search card, with `source.digest` stamped from the entry as submitted, so
 * the card reads as current. A card that doesn't decode is copied as it is; the checks report it.
 */
const copyCard = Effect.fn("submit.copyCard")(function* (registry: string, entry: PlannedEntry) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const card = sidecarPath(entry);
  const bytes = yield* readSearchFile(entry.root, card);
  if (bytes === undefined) return false;
  const target = path.join(registry, card);
  yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
  const loaded = yield* Effect.result((yield* Registry).get(entry.kind, entry.id));
  const decoded = yield* Effect.result(decodeSidecar(bytes));
  const raw = Result.try(() => JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  if (
    Result.isFailure(loaded) ||
    Result.isFailure(decoded) ||
    Result.isFailure(raw) ||
    !isRecord(raw.success) ||
    !isRecord(raw.success.source)
  ) {
    yield* fs.writeFile(target, bytes).pipe(Effect.orDie);
    return true;
  }
  const stamped = {
    ...raw.success,
    source: { ...raw.success.source, digest: searchSourceDigest(loaded.success) },
  };
  yield* fs.writeFileString(target, `${JSON.stringify(stamped, null, 2)}\n`).pipe(Effect.orDie);
  return true;
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the outgoing registry in the clone: each entry under `stacks/` or `fragments/`, its card
 * under `search/`, and its `authors.json` line naming `login`.
 */
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
  yield* Effect.gen(function* () {
    for (const entry of planned) yield* copyCard(options.registry, entry);
  }).pipe(Effect.provide(Registry.layer([{ origin: "bundled", path: options.registry }])));
  const next: Record<string, string> = { ...authors };
  for (const entry of planned) next[authorKey(entry.kind, entry.id)] = options.login;
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  yield* fs.writeFileString(authorsPath, `${JSON.stringify(sorted, null, 2)}\n`).pipe(Effect.orDie);
  return planned;
});
