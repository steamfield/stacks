import { Clock, Effect, FileSystem, Option, Path, Schema, type Scope } from "effect";
import { HttpClient } from "effect/http";
import { RemoteStatus } from "../schemas/remote-index";
import { replaceFile } from "./replace-file";

const DAY = 24 * 60 * 60 * 1000;
const State = Schema.Struct({
  url: Schema.String,
  cachedAt: RemoteStatus.fields.cachedAt,
  lastAttempt: RemoteStatus.fields.lastAttempt,
  lastOutcome: RemoteStatus.fields.lastOutcome,
  backoffUntil: RemoteStatus.fields.backoffUntil,
  backoffs: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

export type CacheFailure = Exclude<NonNullable<typeof State.Type.lastOutcome>, "ok">;
export type Cache = { fs: FileSystem.FileSystem; path: Path.Path; root: string };
type CacheState = typeof State.Type & { backoffs: Record<string, string> };
type Decoder<A, R = never> = (text: string) => Effect.Effect<A, CacheFailure, R>;
type Loaded<A> = { value: A; cacheText: string };
type Loader<A, R = never> = (
  request: (at: string) => Effect.Effect<string, CacheFailure, Scope.Scope>,
) => Effect.Effect<Loaded<A>, CacheFailure, R | Scope.Scope>;
export type CachedResource<A> = {
  current: () => Effect.Effect<Option.Option<A>>;
  cached: Effect.Effect<Option.Option<A>>;
  get: <B, R>(at: string, read: Decoder<B, R>) => Effect.Effect<Option.Option<Loaded<B>>, never, R>;
  status: Effect.Effect<CacheState>;
};

const io = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.orElseSucceed(() => undefined));
const date = (value: string | null) => (value === null ? 0 : Date.parse(value) || 0);

const write = Effect.fn("cachedFetch.write")(function* (cache: Cache, file: string, text: string) {
  const { fs, path, root } = cache;
  yield* fs.makeDirectory(root, { recursive: true });
  yield* replaceFile(path.join(root, file), text).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
  );
});

const boundedFetch = Effect.fn("cachedFetch.request")(function* (
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
  let state: CacheState = {
    url,
    cachedAt: null,
    lastAttempt: null,
    lastOutcome: null,
    backoffUntil: null,
    backoffs: {},
  };
  let body = Option.none<A>();
  const saveState = () => io(write(cache, stateFile, JSON.stringify(state)));
  const initialize = yield* Effect.cached(
    Effect.gen(function* () {
      const saved = yield* io(
        cache.fs
          .readFileString(cache.path.join(cache.root, stateFile))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(State)))),
      );
      if (!saved || saved.url !== url) return;
      state = { ...saved, backoffs: { ...saved.backoffs } };
      const cached = yield* io(
        cache.fs.readFileString(cache.path.join(cache.root, bodyFile)).pipe(Effect.flatMap(decode)),
      );
      if (cached !== undefined) body = Option.some(cached);
    }),
  );

  const recordFailure = Effect.fn("cachedFetch.recordFailure")(function* (
    at: string,
    outcome: CacheFailure,
  ) {
    const backoffUntil = new Date(
      (yield* Clock.currentTimeMillis) + (outcome === "not_found" ? DAY : 600_000),
    ).toISOString();
    state = {
      ...state,
      lastOutcome: outcome,
      backoffUntil,
      backoffs: { ...state.backoffs, [at]: backoffUntil },
    };
    yield* saveState();
  });

  const run = Effect.fn("cachedFetch.run")(function* <B, R>(at: string, load: Loader<B, R>) {
    yield* initialize;
    const now = yield* Clock.currentTimeMillis;
    if (
      options.fetchEnabled === false ||
      (yield* offline) ||
      date(state.backoffs[at] ?? null) > now
    )
      return Option.none<Loaded<B>>();
    state = { ...state, lastAttempt: new Date(now).toISOString() };
    const fetched = yield* Effect.result(
      load((target) => boundedFetch(client, target)).pipe(
        Effect.scoped,
        Effect.timeoutOption(1500),
        Effect.flatMap((result) =>
          Option.isSome(result)
            ? Effect.succeed(result.value)
            : Effect.fail<CacheFailure>("timeout"),
        ),
      ),
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
    const decoded = yield* Effect.result(read(fetched.value.value));
    if (decoded._tag === "Success")
      return Option.some({ value: decoded.success, cacheText: fetched.value.cacheText });
    yield* recordFailure(at, decoded.failure);
    return Option.none<Loaded<B>>();
  });

  const current = Effect.fn("cachedFetch.current")(function* () {
    yield* initialize;
    const now = yield* Clock.currentTimeMillis;
    if (Option.isSome(body) && now - date(state.cachedAt) < DAY) return body;
    const fetched = yield* options.load ? run(url, options.load) : get(url, decode);
    if (Option.isNone(fetched)) return body;
    body = Option.some(fetched.value.value);
    const backoffs = { ...state.backoffs };
    delete backoffs[url];
    state = {
      ...state,
      backoffs,
      cachedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      lastOutcome: "ok",
      backoffUntil: null,
    };
    yield* io(write(cache, bodyFile, fetched.value.cacheText));
    yield* saveState();
    return body;
  });

  const status = initialize.pipe(Effect.map(() => ({ ...state })));
  const cached = initialize.pipe(Effect.map(() => body));
  return { current, cached, get, status } satisfies CachedResource<A>;
});
