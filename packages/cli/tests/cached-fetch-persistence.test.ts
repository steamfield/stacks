import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Layer, Option, Path, PlatformError, Schema } from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";
import { makeCachedFetch } from "../src/core/cached-fetch";
import { NetLayer } from "../src/platform/net";
import { remoteTestDirectory } from "./fixtures/index/refresh";

const decode = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ value: Schema.Number })),
);
const first = { text: '{"value":1}', body: { value: 1 }, etag: '"one"' };
const second = { text: '{"value":2}', body: { value: 2 }, etag: '"two"' };
const refresh = { deadline: Duration.seconds(3), ignoreBackoff: true };

async function setup() {
  const temporary = remoteTestDirectory();
  const origin = join(temporary.path, "origin");
  mkdirSync(origin);
  const server = await temporary.serve(origin);
  const root = join(temporary.path, "cache");
  const url = `${server.url}/index.json`;
  return {
    publish(version: typeof first) {
      writeFileSync(join(origin, "index.json"), version.text);
      server.setEtag(version.etag);
    },
    cacheText: () => readFileSync(join(root, "index.json"), "utf8"),
    validators: () => server.headers.map((headers) => headers["if-none-match"]),
    resource: (options: { alternate?: boolean; failRename?: "index.json" | "state.json" } = {}) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const client = yield* HttpClient.HttpClient;
        const target =
          options.failRename === undefined ? undefined : join(root, options.failRename);
        const cacheFs = FileSystem.make({
          ...fs,
          rename: (from, to) =>
            to === target
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "rename",
                    pathOrDescriptor: to,
                  }),
                )
              : fs.rename(from, to),
        });
        return yield* makeCachedFetch({
          cache: { fs: cacheFs, path, root },
          client,
          url: options.alternate ? `${server.url}/missing.json` : url,
          bodyFile: "index.json",
          stateFile: "state.json",
          decode: (text) => decode(text).pipe(Effect.mapError(() => "invalid" as const)),
          offline: Effect.succeed(false),
        });
      }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetLayer))),
  };
}

it.effect("a rejected body write leaves the fresh value usable and permits the next fetch", () =>
  Effect.gen(function* () {
    const fixture = yield* Effect.promise(setup);
    fixture.publish(first);
    const initial = yield* fixture.resource();
    expect(yield* initial.current()).toEqual(Option.some(first.body));

    fixture.publish(second);
    const failedWrite = yield* fixture.resource({ failRename: "index.json" });
    expect(yield* failedWrite.revalidate(refresh)).toEqual({ source: "fresh" });
    expect(yield* failedWrite.cached).toEqual(Option.some(second.body));
    expect(fixture.cacheText()).toBe(first.text);

    const next = yield* fixture.resource();
    expect(yield* next.cached).toEqual(Option.some(first.body));
    expect(yield* next.revalidate(refresh)).toEqual({ source: "fresh" });
    expect(yield* next.cached).toEqual(Option.some(second.body));
    expect(fixture.validators()).toEqual([undefined, first.etag, undefined]);
    expect(fixture.cacheText()).toBe(second.text);
  }),
);

it.effect("a rejected state write cannot confirm a different body with the previous ETag", () =>
  Effect.gen(function* () {
    const fixture = yield* Effect.promise(setup);
    fixture.publish(first);
    const initial = yield* fixture.resource();
    expect(yield* initial.current()).toEqual(Option.some(first.body));

    fixture.publish(second);
    const failedWrite = yield* fixture.resource({ failRename: "state.json" });
    expect(yield* failedWrite.revalidate(refresh)).toEqual({ source: "fresh" });
    expect(fixture.cacheText()).toBe(second.text);

    fixture.publish(first);
    const next = yield* fixture.resource();
    expect(yield* next.revalidate(refresh)).toEqual({ source: "fresh" });
    expect(yield* next.cached).toEqual(Option.some(first.body));
    expect(fixture.validators()).toEqual([undefined, first.etag, undefined]);
    expect(fixture.cacheText()).toBe(first.text);
  }),
);

it.effect("a failure at a new URL does not adopt the previous URL's cached body", () =>
  Effect.gen(function* () {
    const fixture = yield* Effect.promise(setup);
    fixture.publish(first);
    const initial = yield* fixture.resource();
    expect(yield* initial.current()).toEqual(Option.some(first.body));

    const alternate = { alternate: true };
    const failedFetch = yield* fixture.resource(alternate);
    expect(yield* failedFetch.current()).toEqual(Option.none());
    expect(fixture.cacheText()).toBe(first.text);

    const next = yield* fixture.resource(alternate);
    expect(yield* next.cached).toEqual(Option.none());
    expect(yield* next.revalidate(refresh)).toEqual({ source: "none", reason: "not_found" });
    expect(fixture.validators()).toEqual([undefined, undefined, undefined]);
  }),
);
