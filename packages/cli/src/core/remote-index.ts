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
  temporary: ReturnType<FileSystem.FileSystem["makeTempDirectory"]>;
};

function initialStatus(url: string | null, isDefaultUrl: boolean): RemoteStatus {
  return {
    url,
    isDefaultUrl,
    offline: false,
    cachedAt: null,
    lastAttempt: null,
    lastOutcome: null,
    backoffUntil: null,
  };
}

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

const storeBundle = Effect.fn("remoteIndex.storeBundle")(function* (
  options: Pick<BundleAccess, "cache" | "temporary">,
  bundle: EntryBundle,
  digest: string,
) {
  const { fs, path } = options.cache;
  const cached = yield* Effect.result(persistBundle(options.cache, bundle, digest));
  if (cached._tag === "Success") return cached.success;
  const target = path.join(yield* options.temporary, digest);
  if (yield* directoryMatches({ id: bundle.id, kind: bundle.kind, digest, dir: target }))
    return target;
  yield* fs.makeDirectory(target, { recursive: true });
  yield* extractBundle(bundle, target);
  return target;
});

const downloadBundle = Effect.fn("remoteIndex.downloadBundle")(function* (
  options: Pick<BundleAccess, "cache" | "temporary">,
  entry: IndexEntry,
  text: string,
) {
  const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(EntryBundle))(text).pipe(
    Effect.mapError((): RemoteFailure => "invalid"),
  );
  if (
    decoded.id !== entry.id ||
    decoded.kind !== entry.kind ||
    (yield* bundleDigest(decoded)) !== entry.digest
  ) {
    yield* Effect.logWarning("Remote bundle integrity digest mismatch; using bundled entry.");
    return yield* Effect.fail<RemoteFailure>("invalid");
  }
  return yield* storeBundle(options, decoded, entry.digest).pipe(
    Effect.mapError((): RemoteFailure => "invalid"),
  );
});

const cachedBundle = Effect.fn("remoteIndex.cachedBundle")(function* (
  options: BundleAccess,
  entry: IndexEntry,
) {
  if (!validUrl(options.url) || !Schema.is(RegistryIndex.fields.entries.value)(entry))
    return Option.none<string>();
  const dir = options.cache.path.join(options.cache.root, "entries", entry.digest);
  if (yield* directoryMatches({ ...entry, dir })) return Option.some(dir);
  const at = bundleUrl(options.url, entry);
  const fetched = yield* options.cached.get(at, (text) => downloadBundle(options, entry, text));
  return Option.map(fetched, ({ value }) => value);
});

function unconfiguredIndex(offline: AppConfig["Service"]["offline"]): RemoteIndex["Service"] {
  return {
    current: Effect.succeed(Option.none()),
    bundle: () => Effect.succeed(Option.none()),
    status: offline.pipe(Effect.map((offline) => ({ ...initialStatus(null, false), offline }))),
  };
}

export class RemoteIndex extends Context.Service<
  RemoteIndex,
  {
    readonly current: Effect.Effect<Option.Option<VerifiedIndex>>;
    readonly bundle: (entry: IndexEntry) => Effect.Effect<Option.Option<string>>;
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
        const verification = { isDefaultUrl: url === officialUrl, keys };
        const cached = yield* makeCachedFetch({
          cache,
          client,
          url,
          bodyFile: "index.json",
          stateFile: "state.json",
          decode: (text) => verifyIndex(text, verification),
          offline: config.offline,
          fetchEnabled: validUrl(url),
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

const bundleUrl = (url: string, entry: IndexEntry) =>
  new URL(`entries/${entry.kind}/${entry.id}/${entry.digest}.json`, url).href;

function validUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return (
    !url.username &&
    !url.password &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
  );
}
