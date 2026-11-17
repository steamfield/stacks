/**
 * Runs best-effort hosted search. A deadline and per-endpoint backoff bound the cost of an
 * unavailable API.
 */
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

const REQUEST_DEADLINE_MS = 800;
const BACKOFF_MS = 600_000;
const BACKOFF_FILE = "backoff.json";

/** Backoff persists only expiry times in epoch milliseconds, keyed by API endpoint. */
const Backoffs = Schema.Record(Schema.String, Schema.Number.check(Schema.isFinite()));
type Cache = { fs: FileSystem.FileSystem; path: Path.Path; root: string };

const off = (remoteReason: Extract<RemoteSearch, { remote: "off" }>["remoteReason"]) =>
  ({ remote: "off", remoteReason }) satisfies RemoteSearch;

/** Treat a missing, unreadable or invalid backoff file as empty because it only saves time. */
const readBackoffs = Effect.fn("search.readBackoffs")(function* (cache: Cache) {
  return yield* cache.fs.readFileString(cache.path.join(cache.root, BACKOFF_FILE)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Backoffs))),
    Effect.orElseSucceed((): typeof Backoffs.Type => ({})),
  );
});

/** Store atomically. Backoff only saves time, so this boundary absorbs the entire write cause. */
const saveBackoff = Effect.fn("search.saveBackoff")(function* (
  cache: Cache,
  backoffs: typeof Backoffs.Type,
) {
  yield* Effect.gen(function* () {
    yield* cache.fs.makeDirectory(cache.root, { recursive: true });
    yield* replaceFile(cache.path.join(cache.root, BACKOFF_FILE), JSON.stringify(backoffs)).pipe(
      Effect.provideService(FileSystem.FileSystem, cache.fs),
      Effect.provideService(Path.Path, cache.path),
    );
  }).pipe(Effect.ignoreCause);
});

/** `GET <base>/v1/search`, decoded; any status but 200 fails. */
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

/**
 * Report why a request was skipped. Timeouts and typed failures set backoff and leave local
 * ranking available.
 */
export const remoteSearch = Effect.fn("search.remote")(function* (input: Request) {
  const config = yield* AppConfig;
  if (input.local) return off("local_flag");
  if (input.offline) return off("offline");
  if (config.telemetry.doNotTrack) return off("do_not_track");
  const url = yield* config.apiUrl;
  if (!url) return off("no_endpoint");
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cache = { fs, path, root: path.join((yield* config.paths).cache, "search") };
  const backoffs = yield* readBackoffs(cache);
  if ((backoffs[url] ?? 0) > (yield* Clock.currentTimeMillis)) return off("backoff");
  const response = yield* fetchSearch(url, input).pipe(
    Effect.scoped,
    Effect.timeoutOption(REQUEST_DEADLINE_MS),
    Effect.orElseSucceed(() => Option.none()),
  );
  if (Option.isSome(response))
    return { remote: "used", response: response.value } satisfies RemoteSearch;
  // The expiry counts from when the request gave up, not from when it started.
  yield* saveBackoff(cache, { ...backoffs, [url]: (yield* Clock.currentTimeMillis) + BACKOFF_MS });
  return { remote: "unavailable" } satisfies RemoteSearch;
});
