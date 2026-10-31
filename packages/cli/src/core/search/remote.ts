import { type RankInput, SearchResponse, type SearchResult } from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Option, Path, Schema } from "effect";
import { HttpClient } from "effect/http";
import { AppConfig } from "../../config";
import { replaceFile } from "../replace-file";

type Request = Pick<RankInput, "request" | "limit" | "kind"> & {
  local: boolean;
  offline: boolean;
};
export type RemoteSearch =
  | { remote: "used"; response: SearchResponse }
  | { remote: "unavailable" }
  | { remote: "off"; remoteReason: NonNullable<SearchResult["remoteReason"]> };

const Backoffs = Schema.Record(Schema.String, Schema.Number.check(Schema.isFinite()));
type Cache = { fs: FileSystem.FileSystem; path: Path.Path; root: string };

const readBackoffs = Effect.fn("search.readBackoffs")(function* (cache: Cache) {
  return yield* cache.fs.readFileString(cache.path.join(cache.root, "backoff.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Backoffs))),
    Effect.orElseSucceed((): typeof Backoffs.Type => ({})),
  );
});

const saveBackoff = Effect.fn("search.saveBackoff")(function* (
  cache: Cache,
  backoffs: typeof Backoffs.Type,
) {
  yield* Effect.gen(function* () {
    yield* cache.fs.makeDirectory(cache.root, { recursive: true });
    yield* replaceFile(cache.path.join(cache.root, "backoff.json"), JSON.stringify(backoffs)).pipe(
      Effect.provideService(FileSystem.FileSystem, cache.fs),
      Effect.provideService(Path.Path, cache.path),
    );
  }).pipe(Effect.ignoreCause);
});

const fetchSearch = Effect.fn("search.fetch")(function* (base: string, input: Request) {
  const client = yield* HttpClient.HttpClient;
  const url = new URL("v1/search", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("q", input.request);
  url.searchParams.set("limit", String(input.limit ?? 5));
  if (input.kind) url.searchParams.set("kind", input.kind);
  const response = yield* HttpClient.withScope(client).get(url.href);
  if (response.status !== 200) return yield* Effect.fail("unavailable");
  const text = yield* response.text;
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SearchResponse))(text);
});

/** Only the endpoint and expiry persist; neither requests nor responses are cached. */
export const remoteSearch = Effect.fn("search.remote")(function* (input: Request) {
  const config = yield* AppConfig;
  if (input.local) return { remote: "off", remoteReason: "local_flag" } satisfies RemoteSearch;
  if (input.offline) return { remote: "off", remoteReason: "offline" } satisfies RemoteSearch;
  if (config.telemetry.doNotTrack)
    return { remote: "off", remoteReason: "do_not_track" } satisfies RemoteSearch;
  const url = yield* config.apiUrl;
  if (!url) return { remote: "off", remoteReason: "no_endpoint" } satisfies RemoteSearch;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cache = { fs, path, root: path.join((yield* config.paths).cache, "search") };
  const backoffs = yield* readBackoffs(cache);
  const now = yield* Clock.currentTimeMillis;
  if ((backoffs[url] ?? 0) > now)
    return { remote: "off", remoteReason: "backoff" } satisfies RemoteSearch;
  const response = yield* fetchSearch(url, input).pipe(
    Effect.scoped,
    Effect.timeoutOption(800),
    Effect.orElseSucceed(() => Option.none()),
  );
  if (Option.isSome(response))
    return { remote: "used", response: response.value } satisfies RemoteSearch;
  yield* saveBackoff(cache, {
    ...backoffs,
    [url]: (yield* Clock.currentTimeMillis) + 600_000,
  });
  return { remote: "unavailable" } satisfies RemoteSearch;
});
