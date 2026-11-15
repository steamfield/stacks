/**
 * Asks the hosted search API to rank a `stacks search` request, best-effort and fast.
 *
 * `run.ts::search` runs this beside local ranking and `merge.ts::mergeSearch` combines the two, so
 * a slow or failing API only costs freshness, never the answer. The request is skipped entirely
 * with `--local`, `--offline`, `DO_NOT_TRACK` or when no API endpoint is configured, and the
 * reason travels into the result as `remoteReason`.
 *
 * Two limits keep a bad network from slowing every search. A request gets 800 ms. When it fails
 * or times out, the endpoint goes into backoff for ten minutes: the expiry time is stored per
 * endpoint URL in `search/backoff.json` under the cache directory, and searches skip the API until
 * it passes. Only that expiry persists; requests and responses are never cached.
 *
 * Any typed failure of the request (a network error, a bad status, a response that doesn't
 * decode) means "rank locally". A backoff file that can't be read counts as empty, and one that
 * can't be written is skipped; that write is why this module is on the short list allowed to
 * ignore a whole cause (`.claude/rules/cli/effect.md`, "Errors").
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

/** How long one API request may take before search ranks locally. */
const REQUEST_DEADLINE_MS = 800;
/** How long an endpoint is skipped after a failed or late request. */
const BACKOFF_MS = 600_000;
const BACKOFF_FILE = "backoff.json";

/** Backoff expiry times in epoch milliseconds, keyed by API endpoint URL. */
const Backoffs = Schema.Record(Schema.String, Schema.Number.check(Schema.isFinite()));
type Cache = { fs: FileSystem.FileSystem; path: Path.Path; root: string };

const off = (remoteReason: Extract<RemoteSearch, { remote: "off" }>["remoteReason"]) =>
  ({ remote: "off", remoteReason }) satisfies RemoteSearch;

/** The stored backoffs, or none when the file is missing, unreadable or invalid. */
const readBackoffs = Effect.fn("search.readBackoffs")(function* (cache: Cache) {
  return yield* cache.fs.readFileString(cache.path.join(cache.root, BACKOFF_FILE)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Backoffs))),
    Effect.orElseSucceed((): typeof Backoffs.Type => ({})),
  );
});

/** Stores the backoffs atomically; a failed write is ignored, since backoff only saves time. */
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

/** The API's ranking, or why the API wasn't asked or didn't answer. */
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
