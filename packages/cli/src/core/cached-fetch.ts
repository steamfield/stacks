/**
 * Fetches one remote JSON resource at most once a day, keeping a verified copy on disk.
 *
 * The CLI's optional network data (the signed remote index in `core/remote-index.ts`, the signed
 * dependency allowlist in `core/allowlist.ts`, published stats in `core/stats.ts`) all go through
 * `makeCachedFetch`. Each caller names a body file and a state file under its cache directory and
 * a `decode` that turns response text into a checked value. The body file holds the last response
 * that decoded; the state file records when it was cached, how the last request went and, per
 * request URL, until when that URL is in backoff.
 *
 * The rules a request follows:
 * - A cached body younger than 24 hours is used without a request.
 * - No request is made under `--offline`, when the caller turned fetching off, or while the URL's
 *   backoff hasn't expired. A failure backs the URL off for ten minutes, a 404 for 24 hours.
 * - A request (or a caller's several paged requests) gets 1,500 ms in total.
 * - A failed request, or a response that doesn't decode, keeps whatever was cached before.
 *
 * Network data is a nicety, so nothing here fails: an unreadable or unwritable cache file counts as
 * empty or is skipped, and every outcome comes back as `Option`. A saved state whose `url` differs
 * from the caller's (the user pointed the CLI elsewhere) is ignored along with its body.
 */
import { Clock, Effect, FileSystem, Option, Path, Schema, type Scope } from "effect";
import { HttpClient } from "effect/http";
import { RemoteStatus } from "../schemas/remote-index";
import { replaceFile } from "./replace-file";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a cached body is used before the next request. */
const CACHE_LIFETIME_MS = DAY_MS;
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const NOT_FOUND_BACKOFF_MS = DAY_MS;
const REQUEST_DEADLINE_MS = 1500;

/** The state file's format. `backoffs` maps each request URL to its backoff expiry. */
const State = Schema.Struct({
  url: Schema.String,
  cachedAt: RemoteStatus.fields.cachedAt,
  lastAttempt: RemoteStatus.fields.lastAttempt,
  lastOutcome: RemoteStatus.fields.lastOutcome,
  backoffUntil: RemoteStatus.fields.backoffUntil,
  backoffs: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/** Why a request produced nothing usable; recorded as `lastOutcome`. */
export type CacheFailure = Exclude<NonNullable<typeof State.Type.lastOutcome>, "ok">;
/** The directory a resource's body and state files live in, with the services to reach it. */
export type Cache = { fs: FileSystem.FileSystem; path: Path.Path; root: string };
type CacheState = typeof State.Type & { backoffs: Record<string, string> };
type Decoder<A, R = never> = (text: string) => Effect.Effect<A, CacheFailure, R>;
/** A decoded value with the text to store as the body file. */
type Loaded<A> = { value: A; cacheText: string };
type Request = (at: string) => Effect.Effect<string, CacheFailure, Scope.Scope>;
type Loader<A, R = never> = (
  request: Request,
) => Effect.Effect<Loaded<A>, CacheFailure, R | Scope.Scope>;

/** One cached resource. */
export type CachedResource<A> = {
  /** The cached body while fresh; otherwise a request, falling back to the cached body. */
  current: () => Effect.Effect<Option.Option<A>>;
  /** The cached body at any age, with no request. */
  cached: Effect.Effect<Option.Option<A>>;
  /** Requests another URL under the same state file and backoff rules; nothing is stored. */
  get: <B, R>(at: string, read: Decoder<B, R>) => Effect.Effect<Option.Option<Loaded<B>>, never, R>;
  status: Effect.Effect<CacheState>;
};

const emptyState = (url: string): CacheState => ({
  url,
  cachedAt: null,
  lastAttempt: null,
  lastOutcome: null,
  backoffUntil: null,
  backoffs: {},
});

/** Runs a cache file read or write whose failure is the same as the file being absent. */
const orUndefined = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.orElseSucceed(() => undefined));

/** Milliseconds since the epoch for a stored timestamp; null or unparsable is 0. */
const storedTime = (value: string | null) => (value === null ? 0 : Date.parse(value) || 0);

const isoTime = (millis: number) => new Date(millis).toISOString();

const writeCacheFile = Effect.fn("cachedFetch.write")(function* (
  cache: Cache,
  file: string,
  text: string,
) {
  const { fs, path, root } = cache;
  yield* fs.makeDirectory(root, { recursive: true });
  yield* replaceFile(path.join(root, file), text).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
  );
});

/** One GET: a 404 is `not_found`, any other non-2xx or transport error is `network`. */
const requestText = Effect.fn("cachedFetch.request")(function* (
  client: HttpClient.HttpClient,
  at: string,
) {
  const response = yield* HttpClient.withScope(client)
    .get(at)
    .pipe(Effect.mapError((): CacheFailure => "network"));
  if (response.status === 404) return yield* Effect.fail<CacheFailure>("not_found");
  if (response.status < 200 || response.status >= 300)
    return yield* Effect.fail<CacheFailure>("network");
  return yield* response.text.pipe(Effect.mapError((): CacheFailure => "network"));
});

/** Runs a load in its own scope and fails it as `timeout` past the shared deadline. */
const withinDeadline = <B, R>(load: Effect.Effect<Loaded<B>, CacheFailure, R | Scope.Scope>) =>
  load.pipe(
    Effect.scoped,
    Effect.timeoutOption(REQUEST_DEADLINE_MS),
    Effect.flatMap((loaded) =>
      Option.isSome(loaded) ? Effect.succeed(loaded.value) : Effect.fail<CacheFailure>("timeout"),
    ),
  );

/** Builds one cached resource; nothing is read from disk until it is first used. */
export const makeCachedFetch = Effect.fn("cachedFetch.make")(function* <A>(options: {
  cache: Cache;
  client: HttpClient.HttpClient;
  url: string;
  bodyFile: string;
  stateFile: string;
  decode: Decoder<A>;
  offline: Effect.Effect<boolean>;
  fetchEnabled?: boolean;
  /** Fetches the resource in several requests (a paged summary) within one deadline. */
  load?: Loader<A>;
}) {
  const { cache, client, url, bodyFile, stateFile, decode, offline } = options;
  // Per-invocation state; the layer that calls this owns it.
  let state = emptyState(url);
  let body = Option.none<A>();
  const saveState = () => orUndefined(writeCacheFile(cache, stateFile, JSON.stringify(state)));
  const readCacheFile = (file: string) =>
    cache.fs.readFileString(cache.path.join(cache.root, file));

  /** Loads the saved state and body once; a body that no longer decodes is dropped. */
  const loadSaved = yield* Effect.cached(
    Effect.gen(function* () {
      const saved = yield* orUndefined(
        readCacheFile(stateFile).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(State))),
        ),
      );
      if (!saved || saved.url !== url) return;
      state = { ...saved, backoffs: { ...saved.backoffs } };
      const cached = yield* orUndefined(readCacheFile(bodyFile).pipe(Effect.flatMap(decode)));
      if (cached !== undefined) body = Option.some(cached);
    }),
  );

  const recordFailure = Effect.fn("cachedFetch.recordFailure")(function* (
    at: string,
    outcome: CacheFailure,
  ) {
    const backoff = outcome === "not_found" ? NOT_FOUND_BACKOFF_MS : FAILURE_BACKOFF_MS;
    const backoffUntil = isoTime((yield* Clock.currentTimeMillis) + backoff);
    state = {
      ...state,
      lastOutcome: outcome,
      backoffUntil,
      backoffs: { ...state.backoffs, [at]: backoffUntil },
    };
    yield* saveState();
  });

  const recordSuccess = Effect.fn("cachedFetch.recordSuccess")(function* (loaded: Loaded<A>) {
    body = Option.some(loaded.value);
    const backoffs = { ...state.backoffs };
    delete backoffs[url];
    state = {
      ...state,
      backoffs,
      cachedAt: isoTime(yield* Clock.currentTimeMillis),
      lastOutcome: "ok",
      backoffUntil: null,
    };
    yield* orUndefined(writeCacheFile(cache, bodyFile, loaded.cacheText));
    yield* saveState();
  });

  const mayRequest = Effect.fn("cachedFetch.mayRequest")(function* (at: string, now: number) {
    if (options.fetchEnabled === false || (yield* offline)) return false;
    return storedTime(state.backoffs[at] ?? null) <= now;
  });

  /** Runs `load` for `at` unless fetching is off or `at` is in backoff; a failure backs it off. */
  const run = Effect.fn("cachedFetch.run")(function* <B, R>(at: string, load: Loader<B, R>) {
    yield* loadSaved;
    const now = yield* Clock.currentTimeMillis;
    if (!(yield* mayRequest(at, now))) return Option.none<Loaded<B>>();
    state = { ...state, lastAttempt: isoTime(now) };
    const fetched = yield* Effect.result(
      withinDeadline(load((target) => requestText(client, target))),
    );
    if (fetched._tag === "Success") return Option.some(fetched.success);
    yield* recordFailure(at, fetched.failure);
    return Option.none<Loaded<B>>();
  });

  const get = Effect.fn("cachedFetch.get")(function* <B, R>(at: string, read: Decoder<B, R>) {
    const fetched = yield* run(at, (request) =>
      request(at).pipe(Effect.map((text) => ({ value: text, cacheText: text }))),
    );
    if (Option.isNone(fetched)) return Option.none<Loaded<B>>();
    // Here the deadline covers the request only; `read` runs after it.
    const decoded = yield* Effect.result(read(fetched.value.value));
    if (decoded._tag === "Success")
      return Option.some({ value: decoded.success, cacheText: fetched.value.cacheText });
    yield* recordFailure(at, decoded.failure);
    return Option.none<Loaded<B>>();
  });

  const current = Effect.fn("cachedFetch.current")(function* () {
    yield* loadSaved;
    const now = yield* Clock.currentTimeMillis;
    if (Option.isSome(body) && now - storedTime(state.cachedAt) < CACHE_LIFETIME_MS) return body;
    const fetched = yield* options.load ? run(url, options.load) : get(url, decode);
    if (Option.isNone(fetched)) return body;
    yield* recordSuccess(fetched.value);
    return body;
  });

  const status = loadSaved.pipe(Effect.map(() => ({ ...state })));
  const cached = loadSaved.pipe(Effect.map(() => body));
  return { current, cached, get, status } satisfies CachedResource<A>;
});
