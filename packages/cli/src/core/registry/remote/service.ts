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
import { Context, Duration, Effect, FileSystem, Layer, Option, Path, Schema, Scope } from "effect";
import { HttpClient } from "effect/http";
import { AppConfig } from "../../../config";
import { INDEX_REFRESH_DEADLINE_MS } from "../../../constants";
import type { RemoteStatus } from "../../../schemas/remote-index";
import {
  type Cache,
  type CachedResource,
  makeCachedFetch,
  type Revalidation,
} from "../../cached-fetch";
import { defined } from "../../object";
import { indexRoot } from "../roots";
import type { FileAccess, IndexRegistryRoot } from "../types";
import { directoryMatches, extractBundle } from "./files";
import { type RemoteFailure, verifyIndex } from "./verification";

export { RemoteStatus } from "../../../schemas/remote-index";

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
  const index = Option.getOrUndefined(yield* options.cached.cached);
  return {
    url: state.url,
    isDefaultUrl,
    offline: yield* offline,
    cachedAt: state.cachedAt,
    lastAttempt: state.lastAttempt,
    lastOutcome: state.lastOutcome,
    backoffUntil: state.backoffUntil,
    ...defined({
      commit: index?.commit,
      generatedAt: index?.generatedAt,
      minCli: index?.minCli,
      etag: state.etag,
    }),
  };
});

/**
 * Publish beside the staging directory so readers can only see a complete digest directory.
 */
const publishBundle = Effect.fn("remoteIndex.publishBundle")(function* (
  io: FileAccess,
  bundle: EntryBundle,
  digest: string,
  parent: string,
) {
  const { fs, path } = io;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const staging = yield* Effect.acquireRelease(
        fs.makeTempDirectory({ directory: parent, prefix: ".extract-" }),
        (at) => Effect.ignore(fs.remove(at, { recursive: true, force: true })),
      );
      yield* extractBundle(io, bundle, staging);
      const target = path.join(parent, digest);
      const renamed = yield* Effect.result(fs.rename(staging, target));
      // A concurrent publisher may have won the rename. Only reuse a verified target.
      if (
        renamed._tag === "Failure" &&
        !(yield* directoryMatches(io, { id: bundle.id, kind: bundle.kind, digest, dir: target }))
      )
        return yield* Effect.fail(renamed.failure);
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
  const { cache, temporary } = options;
  const { fs, path, root } = cache;
  const parent = path.join(root, "entries");
  const persisted = yield* fs
    .makeDirectory(parent, { recursive: true })
    .pipe(Effect.andThen(publishBundle(cache, bundle, digest, parent)), Effect.result);
  if (persisted._tag === "Success") return persisted.success;
  const fallback = yield* temporary;
  const target = path.join(fallback, digest);
  // An earlier call in this invocation may already have extracted it here.
  if (yield* directoryMatches(cache, { id: bundle.id, kind: bundle.kind, digest, dir: target }))
    return target;
  return yield* publishBundle(cache, bundle, digest, fallback);
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
  if (yield* directoryMatches(options.cache, { ...entry, dir })) return Option.some(dir);
  const fetched = yield* options.cached.get(bundleUrl(options.url, entry), (text) =>
    acceptBundle(options, entry, text),
  );
  return Option.map(fetched, ({ value }) => value);
});

type IndexAccess = {
  /** The verified index, eligible to refresh when the cached copy reaches `CACHE_FRESHNESS_MS`. */
  readonly current: Effect.Effect<Option.Option<VerifiedIndex>>;
  /** The verified index from memory or disk at any age, with no request. */
  readonly cached: Effect.Effect<Option.Option<VerifiedIndex>>;
  /** The directory holding the entry's verified files, downloading them if needed. */
  readonly bundle: (entry: IndexEntry) => Effect.Effect<Option.Option<string>>;
  /** The cache state for `doctor`, with no request. */
  readonly status: Effect.Effect<RemoteStatus>;
  /**
   * Revalidates the index within `INDEX_REFRESH_DEADLINE_MS`, ignoring backoff, once per
   * invocation: later calls return the same outcome, and afterwards `current` serves what refresh
   * left without a request. With no index root configured it is `{ source: "none" }`.
   */
  readonly refresh: Effect.Effect<Revalidation>;
};

export type ConfiguredIndex = IndexAccess & { readonly root: IndexRegistryRoot };
type UnconfiguredIndex = IndexAccess & { readonly root: undefined };

function unconfiguredIndex(offline: AppConfig["Service"]["offline"]): UnconfiguredIndex {
  return {
    root: undefined,
    current: Effect.succeed(Option.none()),
    cached: Effect.succeed(Option.none()),
    bundle: () => Effect.succeed(Option.none()),
    status: offline.pipe(Effect.map(offStatus)),
    refresh: Effect.succeed({ source: "none" }),
  };
}

export class RemoteIndex extends Context.Service<
  RemoteIndex,
  ConfiguredIndex | UnconfiguredIndex
>()("stacks/RemoteIndex") {
  static layer = ({ keys }: { keys: typeof INDEX_PUBLIC_KEYS }) =>
    Layer.effect(
      RemoteIndex,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const client = yield* HttpClient.HttpClient;
        const config = yield* AppConfig;
        const scope = yield* Scope.Scope;
        const root = yield* indexRoot(config);
        if (root === undefined) return unconfiguredIndex(config.offline);
        const { url } = root;
        const cache = { fs, path, root: path.join((yield* config.paths).cache, "index") };
        const verification = { isDefaultUrl: root.trusted, keys };
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
        let refreshStarted = false;
        const refresh = yield* Effect.cached(
          Effect.gen(function* () {
            refreshStarted = true;
            return yield* cached.revalidate({
              deadline: Duration.millis(INDEX_REFRESH_DEADLINE_MS),
              ignoreBackoff: true,
            });
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                refreshStarted = false;
              }),
            ),
          ),
        );
        return {
          root,
          current: Effect.suspend(() =>
            refreshStarted ? refresh.pipe(Effect.andThen(cached.cached)) : cached.current(),
          ),
          cached: cached.cached,
          status: readStatus(access, config.offline, verification.isDefaultUrl),
          bundle: (entry) => cachedBundle({ ...access, temporary }, entry),
          refresh,
        };
      }),
    );
}
