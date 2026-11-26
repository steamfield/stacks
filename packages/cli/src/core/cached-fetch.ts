/**
 * Caches an optional remote JSON resource and tracks backoff per URL. Cache and network failures are
 * tolerated because callers can run without the resource. The cache ignores a previous URL so its data
 * cannot be attributed to the current one.
 */
import { Clock, type Duration, Effect, FileSystem, Option, Path, Schema, type Scope } from "effect";
import { HttpClient } from "effect/http";
import {
  CACHE_FRESHNESS_MS,
  CACHED_FETCH_DEADLINE_MS,
  FAILURE_BACKOFF_MS,
  NOT_FOUND_BACKOFF_MS,
} from "../constants";
import { RemoteStatus } from "../schemas/remote-index";
import { replaceFile } from "./fs/replace-file";
import { defined } from "./object";

/** The state file's format. `backoffs` maps each request URL to its backoff expiry. */
const State = Schema.Struct({
  url: Schema.String,
  cachedAt: RemoteStatus.fields.cachedAt,
  lastAttempt: RemoteStatus.fields.lastAttempt,
  lastOutcome: RemoteStatus.fields.lastOutcome,
  backoffUntil: RemoteStatus.fields.backoffUntil,
  backoffs: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  etag: RemoteStatus.fields.etag,
  bodyDigest: Schema.optionalKey(Schema.String),
});

/** Why a request produced nothing usable; recorded as `lastOutcome`. */
export type CacheFailure = Exclude<NonNullable<typeof State.Type.lastOutcome>, "ok">;
/** The directory a resource's body and state files live in, with the services to reach it. */
export type Cache = { fs: FileSystem.FileSystem; path: Path.Path; root: string };
type CacheState = typeof State.Type & { backoffs: Record<string, string> };
type Decoder<A, R = never> = (text: string) => Effect.Effect<A, CacheFailure, R>;
/** A decoded value with the text to store as the body file. */
type Loaded<A> = { value: A; cacheText: string };
type ResponseBody = { cacheText: string; etag?: string };
type Request = (at: string) => Effect.Effect<string, CacheFailure, Scope.Scope>;
type Loader<A, R = never> = (
  request: Request,
) => Effect.Effect<Loaded<A>, CacheFailure, R | Scope.Scope>;

/**
 * What `CachedResource.revalidate` left as the body: a new one (`fresh`), the stored one confirmed
 * by a 304 (`revalidated`), the stored one after a failed request (`cached`, with `reason` and
 * `cachedAt`), or nothing usable (`none`, with `reason` when a request failed or wasn't allowed).
 */
export type Revalidation = {
  source: "fresh" | "revalidated" | "cached" | "none";
  reason?: CacheFailure | "offline";
  cachedAt?: string;
};

export type CachedResource<A> = {
  /** The cached body while fresh; otherwise a request, falling back to the cached body. */
  current: () => Effect.Effect<Option.Option<A>>;
  /** The cached body at any age, with no request. */
  cached: Effect.Effect<Option.Option<A>>;
  /**
   * Requests another URL under the same state file and backoff rules. The response isn't kept as
   * this resource's cached body, but a failure still backs that URL off in the state file.
   */
  get: <B, R>(at: string, read: Decoder<B, R>) => Effect.Effect<Option.Option<Loaded<B>>, never, R>;
  status: Effect.Effect<CacheState>;
  /**
   * Requests the resource now whatever its age, with `If-None-Match` when a body and an ETag are
   * stored. `ignoreBackoff` skips the URL's recorded backoff, and a failure records its outcome
   * but no backoff. Never fails: the result says which body `current` and `cached` now serve.
   */
  revalidate: (options: {
    deadline: Duration.Duration;
    ignoreBackoff: boolean;
  }) => Effect.Effect<Revalidation>;
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

/** The body and state are replaced separately, so a digest identifies the bytes the state covers. */
const digestBody = (text: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...new Uint8Array(digest)));
  });

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

/** A solicited 304 has no body. An unsolicited 304 cannot confirm the cached copy. */
const requestText = Effect.fn("cachedFetch.request")(function* (
  client: HttpClient.HttpClient,
  at: string,
  etag?: string,
) {
  const headers = defined({ "if-none-match": etag });
  const response = yield* HttpClient.withScope(client)
    .get(at, { headers })
    .pipe(Effect.mapError((): CacheFailure => "network"));
  if (response.status === 304 && etag !== undefined) return undefined;
  if (response.status === 404) return yield* Effect.fail<CacheFailure>("not_found");
  if (response.status < 200 || response.status >= 300)
    return yield* Effect.fail<CacheFailure>("network");
  const cacheText = yield* response.text.pipe(Effect.mapError((): CacheFailure => "network"));
  return defined({ cacheText, etag: response.headers.etag });
});

const requestBodyText =
  (client: HttpClient.HttpClient): Request =>
  (at) =>
    requestText(client, at).pipe(
      Effect.flatMap((response) =>
        response === undefined
          ? Effect.fail<CacheFailure>("network")
          : Effect.succeed(response.cacheText),
      ),
    );

const withinDeadline = <B, R>(
  load: Effect.Effect<B, CacheFailure, R | Scope.Scope>,
  deadline: Duration.Input = CACHED_FETCH_DEADLINE_MS,
) =>
  load.pipe(
    Effect.scoped,
    Effect.timeoutOption(deadline),
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
      if (saved.cachedAt === null) return;
      const text = yield* orUndefined(readCacheFile(bodyFile));
      if (text === undefined) return;
      if (saved.bodyDigest !== undefined && saved.bodyDigest !== (yield* digestBody(text))) return;
      const cached = yield* orUndefined(decode(text));
      if (cached !== undefined) body = Option.some(cached);
    }),
  );

  const backOff = Effect.fn("cachedFetch.backOff")(function* (at: string, outcome: CacheFailure) {
    const backoff = outcome === "not_found" ? NOT_FOUND_BACKOFF_MS : FAILURE_BACKOFF_MS;
    const backoffUntil = isoTime((yield* Clock.currentTimeMillis) + backoff);
    state = {
      ...state,
      backoffUntil,
      backoffs: { ...state.backoffs, [at]: backoffUntil },
    };
  });

  const requestBlocked = Effect.fn("cachedFetch.requestBlocked")(function* (
    at: string,
    now: number,
    ignoreBackoff: boolean,
  ): Effect.fn.Return<Revalidation["reason"]> {
    if (yield* offline) return "offline";
    if (options.fetchEnabled === false) return "network";
    if (ignoreBackoff || storedTime(state.backoffs[at] ?? null) <= now) return undefined;
    return state.lastOutcome === null || state.lastOutcome === "ok" ? "network" : state.lastOutcome;
  });

  const attempt = Effect.fn("cachedFetch.attempt")(function* <B, R>(
    at: string,
    now: number,
    load: Effect.Effect<B, CacheFailure, R>,
    recordBackoff: boolean,
  ) {
    state = { ...state, lastAttempt: isoTime(now) };
    const fetched = yield* Effect.result(load);
    if (fetched._tag === "Failure") {
      state = { ...state, lastOutcome: fetched.failure };
      if (recordBackoff) yield* backOff(at, fetched.failure);
      yield* saveState();
    }
    return fetched;
  });

  const loadOne = Effect.fn("cachedFetch.loadOne")(function* <B, R>(
    at: string,
    read: Decoder<B, R>,
    request: { deadline?: Duration.Duration; etag?: string } = {},
  ) {
    const response = yield* withinDeadline(requestText(client, at, request.etag), request.deadline);
    if (response === undefined) return undefined;
    // The deadline covers the request; `read` can also persist a verified bundle.
    return { ...response, value: yield* read(response.cacheText) };
  });

  const get = Effect.fn("cachedFetch.get")(function* <B, R>(at: string, read: Decoder<B, R>) {
    yield* loadSaved;
    const now = yield* Clock.currentTimeMillis;
    if (yield* requestBlocked(at, now, false)) return Option.none<Loaded<B>>();
    const fetched = yield* attempt(at, now, loadOne(at, read), true);
    if (fetched._tag === "Failure" || fetched.success === undefined)
      return Option.none<Loaded<B>>();
    const { value, cacheText } = fetched.success;
    return Option.some({ value, cacheText });
  });

  const loadResource = (deadline: Duration.Duration | undefined) =>
    options.load
      ? withinDeadline(options.load(requestBodyText(client)), deadline)
      : loadOne(
          url,
          decode,
          defined({ deadline, etag: Option.isSome(body) ? state.etag : undefined }),
        );

  const persistBody = Effect.fn("cachedFetch.persistBody")(function* (
    loaded: Loaded<A> & ResponseBody,
  ) {
    const bodyDigest = yield* digestBody(loaded.cacheText);
    const written = yield* orUndefined(
      writeCacheFile(cache, bodyFile, loaded.cacheText).pipe(Effect.as(true)),
    );
    body = Option.some(loaded.value);
    const { etag: _oldEtag, ...previous } = state;
    // A failed write leaves the old bytes and their timestamp on disk.
    state = written ? { ...previous, bodyDigest, ...defined({ etag: loaded.etag }) } : previous;
    return written === true;
  });

  const recordSuccess = Effect.fn("cachedFetch.recordSuccess")(function* (
    loaded: (Loaded<A> & ResponseBody) | undefined,
  ) {
    const persisted = loaded === undefined || (yield* persistBody(loaded));
    const cachedAt = persisted ? isoTime(yield* Clock.currentTimeMillis) : state.cachedAt;
    const backoffs = { ...state.backoffs };
    delete backoffs[url];
    state = {
      ...state,
      backoffs,
      cachedAt,
      lastOutcome: "ok",
      backoffUntil: null,
    };
    yield* saveState();
  });

  const fallback = (reason: NonNullable<Revalidation["reason"]>): Revalidation =>
    Option.isSome(body)
      ? { source: "cached", reason, ...defined({ cachedAt: state.cachedAt ?? undefined }) }
      : { source: "none", reason };

  const update = Effect.fn("cachedFetch.update")(function* (
    now: number,
    request: { deadline?: Duration.Duration; ignoreBackoff: boolean; recordBackoff: boolean },
  ): Effect.fn.Return<Revalidation> {
    const blocked = yield* requestBlocked(url, now, request.ignoreBackoff);
    if (blocked !== undefined) return fallback(blocked);
    const fetched = yield* attempt(url, now, loadResource(request.deadline), request.recordBackoff);
    if (fetched._tag === "Failure") return fallback(fetched.failure);
    yield* recordSuccess(fetched.success);
    return { source: fetched.success === undefined ? "revalidated" : "fresh" };
  });

  const current = Effect.fn("cachedFetch.current")(function* () {
    yield* loadSaved;
    const now = yield* Clock.currentTimeMillis;
    if (Option.isSome(body) && now - storedTime(state.cachedAt) < CACHE_FRESHNESS_MS) return body;
    yield* update(now, { ignoreBackoff: false, recordBackoff: true });
    return body;
  });

  const status = loadSaved.pipe(Effect.map(() => ({ ...state })));
  const cached = loadSaved.pipe(Effect.map(() => body));
  const revalidate = Effect.fn("cachedFetch.revalidate")(function* (
    request: Parameters<CachedResource<A>["revalidate"]>[0],
  ) {
    yield* loadSaved;
    const now = yield* Clock.currentTimeMillis;
    return yield* update(now, { ...request, recordBackoff: false });
  });
  return { current, cached, get, status, revalidate } satisfies CachedResource<A>;
});
