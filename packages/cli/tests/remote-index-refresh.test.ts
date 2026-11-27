import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { SignedIndex } from "@steamfield/stacks-format";
import { Effect, Fiber, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { SOURCE_BUILD } from "../src/build";
import { AppConfig } from "../src/config";
import { INDEX_REFRESH_DEADLINE_MS } from "../src/constants";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { NetLayer } from "../src/platform/net";
import {
  index,
  indexEtag,
  indexPath,
  observeResponse,
  serveIndex,
  signIndex,
} from "./fixtures/index/refresh";
import { cacheRoot, environment, keys, remoteLayer } from "./helpers/remote-index";

type Fixture = Awaited<ReturnType<typeof serveIndex>>;
const setup = Effect.promise(serveIndex);
const updatedIndex = { ...index, commit: "b".repeat(40) };
const officialLayer = (fixture: Fixture) =>
  Effect.promise(() => remoteLayer(fixture.home, fixture.server));

function sourceLayer(home: string, officialIndexUrl?: string, trustedKeys = keys) {
  return RemoteIndex.layer({ keys: trustedKeys }).pipe(
    Layer.provide(AppConfig.memory(environment(home), { ...SOURCE_BUILD, officialIndexUrl })),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NetLayer)),
  );
}

const read = Effect.gen(function* () {
  const remote = yield* RemoteIndex;
  return { index: yield* remote.current, status: yield* remote.status };
});

const badSignatures = [
  {
    input: "bad signature",
    expected: "signature",
    response: (envelope: SignedIndex) =>
      JSON.stringify({ ...envelope, signature: Buffer.alloc(64).toString("base64") }),
  },
  {
    input: "unknown key ID",
    expected: "signature",
    response: (envelope: SignedIndex) => JSON.stringify({ ...envelope, keyId: "unknown-test-key" }),
  },
];

it.effect.each([
  ...badSignatures,
  { input: "malformed JSON", expected: "invalid", response: () => "{broken" },
  {
    input: "a signed payload with invalid entries",
    expected: "invalid",
    response: () => JSON.stringify(signIndex({ ...updatedIndex, entries: "invalid" })),
  },
])(
  "an official index with $input records $expected and keeps the verified fallback",
  ({ expected, response }) =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const first = yield* read.pipe(Effect.provide(yield* officialLayer(fixture)));
      expect(first.index).toEqual(Option.some(index));
      expect(first.status.isDefaultUrl).toBe(true);
      expect(first.status.lastOutcome).toBe("ok");
      const body = join(cacheRoot(fixture.home), "index.json");
      const verified = readFileSync(body, "utf8");
      fixture.write(response(signIndex(updatedIndex)));
      yield* TestClock.adjust("24 hours");

      const after = yield* read.pipe(Effect.provide(yield* officialLayer(fixture)));
      expect(after.index).toEqual(first.index);
      expect(fixture.server.requests).toEqual([indexPath, indexPath]);
      expect(readFileSync(body, "utf8")).toBe(verified);
      expect(after.status.lastOutcome).toBe(expected);
    }),
);

it.effect.each(badSignatures)(
  "refresh rejects $input and current keeps the verified fallback",
  ({ response }) =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const first = yield* read.pipe(Effect.provide(yield* officialLayer(fixture)));
      expect(first.index).toEqual(Option.some(index));
      fixture.write(response(signIndex(updatedIndex)));
      yield* TestClock.adjust("24 hours");

      yield* Effect.gen(function* () {
        const remote = yield* RemoteIndex;
        expect(yield* remote.refresh).toEqual({
          source: "cached",
          reason: "signature",
          cachedAt: first.status.cachedAt,
        });
        expect((yield* remote.status).lastOutcome).toBe("signature");
        expect(yield* remote.current).toEqual(first.index);
        expect(fixture.server.requests).toEqual([indexPath, indexPath]);
      }).pipe(Effect.provide(yield* officialLayer(fixture)));
    }),
);

it.effect("an official index signed by the second trusted key verifies", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    const pair = generateKeyPairSync("ed25519");
    const backup = {
      keyId: "index-test-backup",
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
    fixture.write(JSON.stringify(signIndex(index, backup.keyId, pair.privateKey)));
    const url = `${fixture.server.url}${indexPath}`;
    const result = yield* read.pipe(
      Effect.provide(sourceLayer(fixture.home, url, [...keys, backup])),
    );

    expect(result.index).toEqual(Option.some(index));
    expect(result.status).toMatchObject({ url, lastOutcome: "ok", isDefaultUrl: true });
    expect(fixture.server.requests).toEqual([indexPath]);
  }),
);

it.effect("refresh serves the new body and makes one request per invocation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    const first = yield* read.pipe(Effect.provide(yield* officialLayer(fixture)));
    expect(first.index).toEqual(Option.some(index));
    fixture.write(JSON.stringify(signIndex(updatedIndex)));
    const refreshTwice = Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      expect(yield* remote.refresh).toEqual({ source: "fresh" });
      expect(yield* remote.refresh).toEqual({ source: "fresh" });
      expect(yield* remote.current).toEqual(Option.some(updatedIndex));
    });

    yield* refreshTwice.pipe(Effect.provide(yield* officialLayer(fixture)));
    expect(fixture.server.requests).toEqual([indexPath, indexPath]);
    yield* refreshTwice.pipe(Effect.provide(yield* officialLayer(fixture)));
    expect(fixture.server.requests).toEqual([indexPath, indexPath, indexPath]);
  }),
);

it.effect("refresh bypasses an active backoff recorded by a read in another invocation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    fixture.server.mode("not_found");
    const first = yield* read.pipe(Effect.provide(yield* officialLayer(fixture)));
    expect(first.index).toEqual(Option.none());
    expect(first.status).toMatchObject({
      lastOutcome: "not_found",
      backoffUntil: expect.any(String),
    });
    expect(fixture.server.requests).toEqual([indexPath]);
    fixture.server.mode("files");

    yield* Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      expect(yield* remote.refresh).toEqual({ source: "fresh" });
    }).pipe(Effect.provide(yield* officialLayer(fixture)));
    expect(fixture.server.requests).toEqual([indexPath, indexPath]);
  }),
);

it.effect("refresh and current make no second request after an incomplete response times out", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    fixture.server.mode("partial");
    yield* Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      const response = observeResponse();
      const fiber = yield* Effect.forkChild(
        remote.refresh.pipe(Effect.provideService(FetchHttpClient.Fetch, response.fetch)),
      );
      yield* response.awaitHeaders(fiber);
      yield* TestClock.adjust(INDEX_REFRESH_DEADLINE_MS + 1);
      const expected = { source: "none", reason: "timeout" };
      expect(yield* Fiber.join(fiber)).toEqual(expected);

      fixture.server.mode("files");
      expect(yield* remote.current).toEqual(Option.none());
      expect(fixture.server.requests).toEqual([indexPath]);
      expect(yield* remote.refresh).toEqual(expected);
      expect(fixture.server.requests).toEqual([indexPath]);
    }).pipe(Effect.provide(yield* officialLayer(fixture)));
  }),
);

it.effect("refresh succeeds with a response delivered just before the index deadline", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      const response = observeResponse(true);
      const fiber = yield* Effect.forkChild(
        remote.refresh.pipe(Effect.provideService(FetchHttpClient.Fetch, response.fetch)),
      );
      yield* response.awaitHeaders(fiber);
      yield* TestClock.adjust(INDEX_REFRESH_DEADLINE_MS - 1);
      response.release();

      expect(yield* Fiber.join(fiber)).toEqual({ source: "fresh" });
      expect(fixture.server.requests).toEqual([indexPath]);
    }).pipe(Effect.provide(yield* officialLayer(fixture)));
  }),
);

it.effect("refresh and current serve the stale cache without retrying a network failure", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    const first = yield* read.pipe(Effect.provide(yield* officialLayer(fixture)));
    expect(first.index).toEqual(Option.some(index));
    yield* TestClock.adjust("24 hours");
    fixture.server.mode("network");

    yield* Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      const expected = {
        source: "cached",
        reason: "network",
        cachedAt: first.status.cachedAt,
      };
      expect(yield* remote.refresh).toEqual(expected);
      const requestsAfterFailure = fixture.server.requests.length;
      expect(requestsAfterFailure).toBeGreaterThan(1);

      fixture.server.mode("files");
      expect(yield* remote.current).toEqual(first.index);
      expect(fixture.server.requests).toHaveLength(requestsAfterFailure);
      expect(yield* remote.refresh).toEqual(expected);
      expect(fixture.server.requests).toHaveLength(requestsAfterFailure);
    }).pipe(Effect.provide(yield* officialLayer(fixture)));
  }),
);

it.effect("current serves the 304-confirmed body without another request in the invocation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    fixture.server.setEtag(indexEtag);
    const first = yield* read.pipe(Effect.provide(yield* officialLayer(fixture)));
    expect(first.index).toEqual(Option.some(index));

    yield* Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      expect(yield* remote.refresh).toEqual({ source: "revalidated" });

      // Even after freshness expires, this invocation serves what refresh left.
      yield* TestClock.adjust("24 hours");
      expect(yield* remote.current).toEqual(first.index);
      expect(fixture.server.requests).toEqual([indexPath, indexPath]);
      expect(fixture.server.headers.map((header) => header["if-none-match"])).toEqual([
        undefined,
        indexEtag,
      ]);
    }).pipe(Effect.provide(yield* officialLayer(fixture)));
  }),
);

it.effect("an unconfigured index has no refresh source or fallback reason", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const remote = yield* RemoteIndex;
      expect(remote.root).toBeUndefined();
      expect(yield* remote.refresh).toEqual({ source: "none" });
      expect(fixture.server.requests).toEqual([]);
    }).pipe(Effect.provide(sourceLayer(fixture.home)));
  }),
);
