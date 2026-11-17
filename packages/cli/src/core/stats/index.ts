/**
 * Provides published usage stats through `makeCachedFetch`. Offline invocations omit even cached
 * stats, and an alternate index URL disables stats because the counts describe the official
 * registry. Listing and review can still succeed when a fetch fails and no stats are available.
 */
import { type Kind, StatsDetail, StatsSummary } from "@steamfield/stacks-format";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema, type Scope } from "effect";
import { HttpClient } from "effect/http";
import { AppConfig } from "../../config";
import { type Cache, type CacheFailure, makeCachedFetch } from "../cached-fetch";

type Request = (at: string) => Effect.Effect<string, CacheFailure, Scope.Scope>;

const decodeWireSummary = (text: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(StatsSummary))(text).pipe(
    Effect.mapError((): CacheFailure => "invalid"),
  );
const decodeWireDetail = (text: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(StatsDetail))(text).pipe(
    Effect.mapError((): CacheFailure => "invalid"),
  );

function sameRecord(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
) {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([key, value]) => right[key] === value)
  );
}

function sameEntryPoints(left: StatsSummary, right: StatsSummary): boolean {
  if (!left.published || !right.published) return true;
  return (
    sameRecord(left.entryPoints.handoff, right.entryPoints.handoff) &&
    sameRecord(left.entryPoints.source, right.entryPoints.source)
  );
}

/** True when two summary pages describe the same snapshot, so their items can be joined. */
function sameHeader(left: StatsSummary, right: StatsSummary): boolean {
  return (
    left.generatedAt === right.generatedAt &&
    left.through === right.through &&
    left.population === right.population &&
    left.window === right.window &&
    left.published === right.published &&
    sameEntryPoints(left, right)
  );
}

function pageUrl(summaryUrl: string, cursor: string): string {
  const next = new URL(summaryUrl);
  next.searchParams.set("cursor", cursor);
  return next.href;
}

/** Appends a page's items, decoding the joined summary again so its own checks still hold. */
const appendPage = (joined: StatsSummary, page: StatsSummary) =>
  Schema.decodeUnknownEffect(Schema.toType(StatsSummary))({
    ...joined,
    items: [...joined.items, ...page.items],
  }).pipe(Effect.mapError((): CacheFailure => "invalid"));

/**
 * Join pages only when they describe the same snapshot. A repeated cursor fails to prevent a
 * loop, and `makeCachedFetch` gives all pages one deadline.
 */
const summaryPages = Effect.fn("stats.summaryPages")(function* (url: string, request: Request) {
  const fetchPage = (at: string) => request(at).pipe(Effect.flatMap(decodeWireSummary));
  let page = yield* fetchPage(url);
  let joined = page;
  const seen = new Set<string>();
  while (page.nextCursor !== undefined) {
    if (seen.has(page.nextCursor)) return yield* Effect.fail<CacheFailure>("invalid");
    seen.add(page.nextCursor);
    page = yield* fetchPage(pageUrl(url, page.nextCursor));
    if (!sameHeader(joined, page)) return yield* Effect.fail<CacheFailure>("invalid");
    joined = yield* appendPage(joined, page);
  }
  const { nextCursor: _nextCursor, ...value } = joined;
  return { value, cacheText: JSON.stringify(Schema.encodeSync(StatsSummary)(value)) };
});

/** A detail response must describe the entry that was asked for. */
const decodeDetailFor = (kind: Kind, id: string) => (text: string) =>
  decodeWireDetail(text).pipe(
    Effect.flatMap((value) =>
      value.kind === kind && value.id === id
        ? Effect.succeed(value)
        : Effect.fail<CacheFailure>("invalid"),
    ),
  );

type StatsAccess = {
  cache: Cache;
  client: HttpClient.HttpClient;
  /** The API's `/v1/` base URL. */
  base: string;
  offline: Effect.Effect<boolean>;
};

const fetchDetail = Effect.fn("stats.detail")(function* (
  access: StatsAccess,
  kind: Kind,
  id: string,
) {
  const detailUrl = new URL(`${kind}s/${encodeURIComponent(id)}/stats`, access.base).href;
  const file = `${kind}-${id}`;
  const decode = decodeDetailFor(kind, id);
  const detail = yield* makeCachedFetch({
    cache: access.cache,
    client: access.client,
    url: detailUrl,
    bodyFile: `${file}.json`,
    stateFile: `${file}.state.json`,
    decode,
    offline: access.offline,
    load: (request) =>
      Effect.map(request(detailUrl).pipe(Effect.flatMap(decode)), (value) => ({
        value,
        cacheText: JSON.stringify(Schema.encodeSync(StatsDetail)(value)),
      })),
  });
  return yield* detail.current();
});

const noStats = {
  summary: Effect.succeed(Option.none<StatsSummary>()),
  detail: () => Effect.succeed(Option.none<StatsDetail>()),
};

export class Stats extends Context.Service<
  Stats,
  {
    readonly summary: Effect.Effect<Option.Option<StatsSummary>>;
    readonly detail: (kind: Kind, id: string) => Effect.Effect<Option.Option<StatsDetail>>;
  }
>()("stacks/Stats") {
  static layer = Layer.effect(
    Stats,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const client = yield* HttpClient.HttpClient;
      const config = yield* AppConfig;
      const apiUrl = yield* config.apiUrl;
      const indexUrl = yield* config.indexUrl;
      const cache = { fs, path, root: path.join((yield* config.paths).cache, "stats") };
      if (apiUrl === undefined || indexUrl !== undefined) return noStats;
      const base = new URL("/v1/", apiUrl).href;
      const url = new URL("stats", base).href;
      const summary = yield* makeCachedFetch({
        cache,
        client,
        url,
        bodyFile: "summary.json",
        stateFile: "summary.state.json",
        decode: decodeWireSummary,
        offline: config.offline,
        load: (request) => summaryPages(url, request),
      });
      const access = { cache, client, base, offline: config.offline };
      return {
        summary: Effect.gen(function* () {
          if (yield* config.offline) return Option.none<StatsSummary>();
          return yield* summary.current();
        }),
        detail: (kind: Kind, id: string) =>
          Effect.gen(function* () {
            if (yield* config.offline) return Option.none<StatsDetail>();
            return yield* fetchDetail(access, kind, id);
          }),
      };
    }),
  );
}
