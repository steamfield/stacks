import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Clock, Duration, Effect, Fiber, FileSystem, Layer, Option, Path, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { makeCachedFetch } from "../src/core/cached-fetch";
import { NetLayer } from "../src/platform/net";
import { observeResponse, remoteTestDirectory } from "./fixtures/index/refresh";

const Body = Schema.fromJsonString(Schema.Struct({ value: Schema.Number }));
const cachedText = '{ "value": 1 }\n';
const freshText = '{"value":2}';
const oldEtag = '"summary-v1"';
const newEtag = '"summary-v2"';
const cachedAt = "1970-01-01T00:00:00.000Z";
const deadlineMs = 250;
const revalidation = { deadline: Duration.millis(deadlineMs), ignoreBackoff: true };
const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString());

async function setup() {
  const dir = remoteTestDirectory();
  const origin = join(dir.path, "origin");
  const root = join(dir.path, "cache");
  mkdirSync(origin);
  mkdirSync(root);
  writeFileSync(join(origin, "summary.json"), freshText);
  const server = await dir.serve(origin);
  const url = `${server.url}/summary.json`;
  const body = join(root, "summary.json");
  const state = join(root, "state.json");
  return {
    server,
    url,
    body,
    headers: () => server.headers.map((request) => request["if-none-match"]),
    readState: () => JSON.parse(readFileSync(state, "utf8")) as unknown,
    seed({ text, etag, origin = url }: { text?: string; etag?: string; origin?: string }) {
      if (text !== undefined) writeFileSync(body, text);
      writeFileSync(
        state,
        JSON.stringify({
          url: origin,
          cachedAt,
          lastAttempt: cachedAt,
          lastOutcome: "invalid",
          backoffUntil: null,
          ...(etag === undefined ? {} : { etag }),
        }),
      );
    },
    resource: (offline = false) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const client = yield* HttpClient.HttpClient;
        return yield* makeCachedFetch({
          cache: { fs, path, root },
          client,
          url,
          bodyFile: "summary.json",
          stateFile: "state.json",
          decode: (text) =>
            Schema.decodeUnknownEffect(Body)(text).pipe(Effect.mapError(() => "invalid" as const)),
          offline: Effect.succeed(offline),
        });
      }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetLayer))),
  };
}

it.effect("304 renews the cache state and preserves the existing body file", () =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    cache.seed({ text: cachedText, etag: oldEtag });
    cache.server.setEtag(oldEtag);
    // A fixed old mtime also detects rewriting the same bytes.
    utimesSync(cache.body, 1, 1);
    const originalMtime = statSync(cache.body).mtimeMs;
    yield* TestClock.adjust("1 hour");
    const resource = yield* cache.resource();

    expect(yield* resource.revalidate(revalidation)).toEqual({ source: "revalidated" });
    expect(cache.headers()).toEqual([oldEtag]);
    expect(cache.readState()).toMatchObject({
      cachedAt: yield* now,
      lastOutcome: "ok",
      etag: oldEtag,
    });
    expect(readFileSync(cache.body, "utf8")).toBe(cachedText);
    expect(statSync(cache.body).mtimeMs).toBe(originalMtime);
    expect(yield* resource.cached).toEqual(Option.some({ value: 1 }));
  }),
);

it.effect.each([
  { name: "a missing body", text: undefined },
  { name: "an undecodable body", text: '{"value":"wrong"}' },
])("an ETag with $name results in an unconditional 200", ({ text }) =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    cache.seed({ text, etag: oldEtag });
    cache.server.setEtag(newEtag);
    const resource = yield* cache.resource();

    expect(yield* resource.revalidate(revalidation)).toEqual({ source: "fresh" });
    expect(cache.headers()).toEqual([undefined]);
    expect(cache.readState()).toMatchObject({ etag: newEtag, lastOutcome: "ok" });
    expect(readFileSync(cache.body, "utf8")).toBe(freshText);
    expect(yield* resource.cached).toEqual(Option.some({ value: 2 }));
  }),
);

it.effect.each([
  {
    name: "without a body",
    text: undefined,
    etag: oldEtag,
    expected: { source: "none", reason: "network" },
  },
  {
    name: "with a body and no ETag",
    text: cachedText,
    etag: undefined,
    expected: { source: "cached", reason: "network", cachedAt },
  },
])(
  "an unsolicited 304 $name returns a network failure after one request",
  ({ text, etag, expected }) =>
    Effect.gen(function* () {
      const cache = yield* Effect.promise(setup);
      cache.seed({ text, etag });
      cache.server.mode("not_modified");
      const resource = yield* cache.resource();

      expect(yield* resource.revalidate(revalidation)).toEqual(expected);
      expect(cache.headers()).toEqual([undefined]);
      expect(cache.readState()).toMatchObject({ lastOutcome: "network" });
      expect(yield* resource.cached).toEqual(
        text === undefined ? Option.none() : Option.some({ value: 1 }),
      );
    }),
);

it.effect("200 replaces the body and a new resource sends the saved response ETag", () =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    cache.seed({ text: cachedText, etag: oldEtag });
    cache.server.setEtag(newEtag);
    const first = yield* cache.resource();

    expect(yield* first.revalidate(revalidation)).toEqual({ source: "fresh" });
    expect(readFileSync(cache.body, "utf8")).toBe(freshText);
    expect(cache.readState()).toMatchObject({ etag: newEtag, lastOutcome: "ok" });
    expect(yield* first.cached).toEqual(Option.some({ value: 2 }));

    const next = yield* cache.resource();
    expect(yield* next.revalidate(revalidation)).toEqual({ source: "revalidated" });
    expect(cache.headers()).toEqual([oldEtag, newEtag]);
  }),
);

it.effect("200 without an ETag drops the previous body's validator", () =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    cache.seed({ text: cachedText, etag: oldEtag });
    const first = yield* cache.resource();

    expect(yield* first.revalidate(revalidation)).toEqual({ source: "fresh" });
    expect(cache.readState()).not.toHaveProperty("etag");
    expect(yield* first.cached).toEqual(Option.some({ value: 2 }));

    const next = yield* cache.resource();
    expect(yield* next.revalidate(revalidation)).toEqual({ source: "fresh" });
    expect(cache.headers()).toEqual([oldEtag, undefined]);
  }),
);

it.effect("a new read honors recorded backoff while forced revalidation requests the URL", () =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    cache.server.mode("not_found");
    const first = yield* cache.resource();
    expect(yield* first.current()).toEqual(Option.none());
    expect(cache.readState()).toMatchObject({
      backoffs: { [cache.url]: expect.any(String) },
    });

    cache.server.mode("files");
    const next = yield* cache.resource();
    expect(yield* next.current()).toEqual(Option.none());
    expect(cache.server.requests).toEqual(["/summary.json"]);

    yield* next.revalidate({ ...revalidation, ignoreBackoff: false });
    expect(cache.server.requests).toEqual(["/summary.json"]);

    expect(yield* next.revalidate(revalidation)).toEqual({ source: "fresh" });
    expect(cache.server.requests).toEqual(["/summary.json", "/summary.json"]);
    expect(yield* next.cached).toEqual(Option.some({ value: 2 }));
  }),
);

it.effect.each([
  { name: "with a cached body", text: cachedText, expected: { source: "cached", cachedAt } },
  { name: "without a cached body", text: undefined, expected: { source: "none" } },
])("an incomplete response reaches the supplied deadline $name", ({ text, expected }) =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    if (text !== undefined) cache.seed({ text });
    yield* TestClock.adjust("1 hour");
    cache.server.mode("partial");
    const resource = yield* cache.resource();
    const response = observeResponse();
    const fiber = yield* Effect.forkChild(
      resource
        .revalidate(revalidation)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, response.fetch)),
    );
    yield* response.awaitHeaders(fiber);
    yield* TestClock.adjust(deadlineMs + 1);

    expect(yield* Fiber.join(fiber)).toEqual({
      ...expected,
      reason: "timeout",
    });
    expect(cache.server.requests).toEqual(["/summary.json"]);
    expect(cache.readState()).toMatchObject({ lastOutcome: "timeout" });
  }),
);

it.effect("a response delivered just before the supplied deadline succeeds", () =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    const resource = yield* cache.resource();
    const response = observeResponse(true);
    const fiber = yield* Effect.forkChild(
      resource
        .revalidate(revalidation)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, response.fetch)),
    );
    yield* response.awaitHeaders(fiber);
    yield* TestClock.adjust(deadlineMs - 1);
    response.release();

    expect(yield* Fiber.join(fiber)).toEqual({ source: "fresh" });
    expect(cache.server.requests).toEqual(["/summary.json"]);
  }),
);

it.effect.each([
  { name: "with a cached body", text: cachedText, expected: { source: "cached", cachedAt } },
  { name: "without a cached body", text: undefined, expected: { source: "none" } },
])("offline revalidation $name makes zero requests", ({ text, expected }) =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    if (text !== undefined) cache.seed({ text, etag: oldEtag });
    const resource = yield* cache.resource(true);

    expect(yield* resource.revalidate(revalidation)).toEqual({ ...expected, reason: "offline" });
    expect(cache.server.requests).toEqual([]);
  }),
);

it.effect("a legacy state without an ETag still loads and requests unconditionally", () =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    cache.seed({ text: cachedText });
    const resource = yield* cache.resource();

    expect(yield* resource.cached).toEqual(Option.some({ value: 1 }));
    expect(cache.server.requests).toEqual([]);
    expect(yield* resource.revalidate(revalidation)).toEqual({ source: "fresh" });
    expect(cache.headers()).toEqual([undefined]);
  }),
);

it.effect("a failed request cannot send a validator or return a body saved for another URL", () =>
  Effect.gen(function* () {
    const cache = yield* Effect.promise(setup);
    cache.seed({
      text: cachedText,
      etag: oldEtag,
      origin: "https://previous.example.test/summary",
    });
    cache.server.mode("not_found");
    const resource = yield* cache.resource();

    expect(yield* resource.revalidate(revalidation)).toEqual({
      source: "none",
      reason: "not_found",
    });
    expect(cache.headers()).toEqual([undefined]);
  }),
);

it.effect.each([
  { name: "without prior backoff", priorBackoff: false },
  { name: "with prior backoff", priorBackoff: true },
])(
  "a failed revalidation records its attempt and leaves backoff as it was $name",
  ({ priorBackoff }) =>
    Effect.gen(function* () {
      const cache = yield* Effect.promise(setup);
      const resource = yield* cache.resource();
      if (priorBackoff) {
        cache.server.mode("not_found");
        expect(yield* resource.current()).toEqual(Option.none());
      }
      const before = yield* resource.status;
      const requestsBefore = cache.server.requests.length;
      yield* TestClock.adjust("1 second");
      cache.server.mode("network");

      expect(yield* resource.revalidate(revalidation)).toEqual({
        source: "none",
        reason: "network",
      });
      expect(cache.server.requests.length).toBeGreaterThan(requestsBefore);
      const state = cache.readState();
      expect(state).toMatchObject({
        lastAttempt: yield* now,
        lastOutcome: "network",
        backoffUntil: before.backoffUntil,
      });
      if (priorBackoff) expect(state).toHaveProperty("backoffs", before.backoffs);
      else expect(state).not.toHaveProperty(["backoffs", cache.url]);
      expect((yield* resource.status).backoffs).toEqual(before.backoffs);
    }),
);
