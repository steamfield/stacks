/**
 * Fetches and verifies the optional remote index through `makeCachedFetch` and `verifyIndex`
 * (trust point 2). Bundles fall back to invocation-scoped temporary storage so an unwritable
 * cache does not make them unusable.
 */
import {
  bundleDigest,
  EntryBundle,
  type INDEX_PUBLIC_KEYS,
  type IndexEntry,
  RegistryIndex,
} from "@steamfield/stacks-format";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Scope } from "effect";
import { HttpClient } from "effect/http";
import { AppConfig } from "../config";
import type { RemoteStatus } from "../schemas/remote-index";
import { type Cache, type CachedResource, makeCachedFetch } from "./cached-fetch";
import { directoryMatches, extractBundle } from "./remote-index/files";
import { type RemoteFailure, verifyIndex } from "./remote-index/verification";

export { RemoteStatus } from "../schemas/remote-index";

type VerifiedIndex = RegistryIndex;
type Access = {
  cache: Cache;
  cached: CachedResource<VerifiedIndex>;
  url: string;
};
type BundleAccess = Access & {
  /** The invocation's fallback directory, created on first use. */
  temporary: ReturnType<FileSystem.FileSystem["makeTempDirectory"]>;
};

/**
 * True for a URL the CLI may fetch: HTTPS, or HTTP to localhost or 127.0.0.1, with no credentials.
 * Any other configured URL keeps the origin on but makes no request.
 */
function isFetchableUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
}

const bundleUrl = (indexUrl: string, entry: IndexEntry) =>
  new URL(`entries/${entry.kind}/${entry.id}/${entry.digest}.json`, indexUrl).href;

const offStatus = (offline: boolean): RemoteStatus => ({
  url: null,
  isDefaultUrl: false,
  offline,
  cachedAt: null,
  lastAttempt: null,
  lastOutcome: null,
  backoffUntil: null,
});

const readStatus = Effect.fn("remoteIndex.readStatus")(function* (
  options: Access,
  offline: AppConfig["Service"]["offline"],
  isDefaultUrl: boolean,
) {
  const state = yield* options.cached.status;
  return {
    url: state.url,
    isDefaultUrl,
    offline: yield* offline,
    cachedAt: state.cachedAt,
    lastAttempt: state.lastAttempt,
    lastOutcome: state.lastOutcome,
    backoffUntil: state.backoffUntil,
  };
});

/**
 * Extracts into a staging directory beside the cache, then renames it to its digest, so a cache
 * directory named for a digest is never half written. Staging is removed whatever happens.
 */
const persistBundle = Effect.fn("remoteIndex.persistBundle")(function* (
  cache: Cache,
  bundle: EntryBundle,
  digest: string,
) {
  const { fs, path, root } = cache;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const parent = path.join(root, "entries");
      yield* fs.makeDirectory(parent, { recursive: true });
      const staging = yield* Effect.acquireRelease(
        fs.makeTempDirectory({ directory: parent, prefix: ".extract-" }),
        (at) => Effect.ignore(fs.remove(at, { recursive: true, force: true })),
      );
      yield* extractBundle(bundle, staging);
      const target = path.join(parent, digest);
      yield* fs.rename(staging, target);
      return target;
    }),
  );
});

/** Stores a verified bundle in the cache, or in the invocation's temporary directory instead. */
const storeBundle = Effect.fn("remoteIndex.storeBundle")(function* (
  options: Pick<BundleAccess, "cache" | "temporary">,
  bundle: EntryBundle,
  digest: string,
) {
  const { fs, path } = options.cache;
  const persisted = yield* Effect.result(persistBundle(options.cache, bundle, digest));
  if (persisted._tag === "Success") return persisted.success;
  const target = path.join(yield* options.temporary, digest);
  // An earlier call in this invocation may already have extracted it here.
  if (yield* directoryMatches({ id: bundle.id, kind: bundle.kind, digest, dir: target }))
    return target;
  yield* fs.makeDirectory(target, { recursive: true });
  yield* extractBundle(bundle, target);
  return target;
});

/** A bundle must match the index entry's id, kind and digest before extraction. */
const acceptBundle = Effect.fn("remoteIndex.acceptBundle")(function* (
  options: Pick<BundleAccess, "cache" | "temporary">,
  entry: IndexEntry,
  text: string,
) {
  const bundle = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(EntryBundle))(text).pipe(
    Effect.mapError((): RemoteFailure => "invalid"),
  );
  if (
    bundle.id !== entry.id ||
    bundle.kind !== entry.kind ||
    (yield* bundleDigest(bundle)) !== entry.digest
  ) {
    yield* Effect.logWarning("Remote bundle integrity digest mismatch; using bundled entry.");
    return yield* Effect.fail<RemoteFailure>("invalid");
  }
  return yield* storeBundle(options, bundle, entry.digest).pipe(
    Effect.mapError((): RemoteFailure => "invalid"),
  );
});

/** An entry's verified files: the cached directory while it still matches, else a download. */
const cachedBundle = Effect.fn("remoteIndex.cachedBundle")(function* (
  options: BundleAccess,
  entry: IndexEntry,
) {
  // `entry` comes from callers, so its shape is checked before its digest names a path.
  if (!isFetchableUrl(options.url) || !Schema.is(RegistryIndex.fields.entries.value)(entry))
    return Option.none<string>();
  const dir = options.cache.path.join(options.cache.root, "entries", entry.digest);
  if (yield* directoryMatches({ ...entry, dir })) return Option.some(dir);
  const fetched = yield* options.cached.get(bundleUrl(options.url, entry), (text) =>
    acceptBundle(options, entry, text),
  );
  return Option.map(fetched, ({ value }) => value);
});

function unconfiguredIndex(offline: AppConfig["Service"]["offline"]): RemoteIndex["Service"] {
  return {
    current: Effect.succeed(Option.none()),
    bundle: () => Effect.succeed(Option.none()),
    status: offline.pipe(Effect.map(offStatus)),
  };
}

export class RemoteIndex extends Context.Service<
  RemoteIndex,
  {
    /** The verified index, refreshed when the cached copy is older than 24 hours. */
    readonly current: Effect.Effect<Option.Option<VerifiedIndex>>;
    /** The directory holding the entry's verified files, downloading them if needed. */
    readonly bundle: (entry: IndexEntry) => Effect.Effect<Option.Option<string>>;
    /** The cache state for `doctor`, with no request. */
    readonly status: Effect.Effect<RemoteStatus>;
  }
>()("stacks/RemoteIndex") {
  static layer = ({
    keys,
    officialUrl,
  }: {
    keys: typeof INDEX_PUBLIC_KEYS;
    officialUrl: string | undefined;
  }) =>
    Layer.effect(
      RemoteIndex,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const client = yield* HttpClient.HttpClient;
        const config = yield* AppConfig;
        const scope = yield* Scope.Scope;
        const url = (yield* config.indexUrl) ?? officialUrl;
        if (url === undefined) return unconfiguredIndex(config.offline);
        const cache = { fs, path, root: path.join((yield* config.paths).cache, "index") };
        // Only the official index can confer trust, so `verifyIndex` requires its signature.
        const verification = { isDefaultUrl: url === officialUrl, keys };
        const cached = yield* makeCachedFetch({
          cache,
          client,
          url,
          bodyFile: "index.json",
          stateFile: "state.json",
          decode: (text) => verifyIndex(text, verification),
          offline: config.offline,
          fetchEnabled: isFetchableUrl(url),
        });
        // A scoped temporary root keeps this invocation usable if the cache cannot be written.
        const temporary = yield* Effect.cached(
          fs
            .makeTempDirectoryScoped({ prefix: "stacks-index-" })
            .pipe(Effect.provideService(Scope.Scope, scope)),
        );
        const access = { cache, cached, url };
        return {
          current: cached.current(),
          status: readStatus(access, config.offline, verification.isDefaultUrl),
          bundle: (entry) =>
            cachedBundle({ ...access, temporary }, entry).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            ),
        };
      }),
    );
}
