import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Layer, Option, Path } from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";
import { makeCachedFetch } from "../src/core/cached-fetch";
import { NetLayer } from "../src/platform/net";
import { tempDir } from "./helpers/cli";
import { heldServer } from "./helpers/held-server";

it.live("persists both concurrent bundle backoffs for the next invocation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { path: root } = yield* Effect.acquireRelease(Effect.sync(tempDir), ({ cleanup }) =>
        Effect.sync(cleanup),
      );
      const server = yield* Effect.acquireRelease(
        Effect.promise(() => heldServer(root, () => false)),
        (server) => Effect.promise(() => server.close()),
      );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const client = yield* HttpClient.HttpClient;
      const stagedFirst = yield* Deferred.make<void>();
      const persistedSecond = yield* Deferred.make<void>();
      let renames = 0;
      const stateFile = "state.json";
      const gated: FileSystem.FileSystem = {
        ...fs,
        rename: (from, to) => {
          const rename = fs.rename(from, to);
          if (to !== join(root, stateFile)) return rename;
          return Effect.suspend(() => {
            renames += 1;
            if (renames !== 1) {
              return rename.pipe(Effect.tap(() => Deferred.succeed(persistedSecond, undefined)));
            }
            return Deferred.succeed(stagedFirst, undefined).pipe(
              Effect.andThen(Deferred.await(persistedSecond)),
              // A serial writer releases the first rename without any second rename in flight.
              Effect.timeoutOption("3 seconds"),
              Effect.andThen(rename),
            );
          });
        },
      };
      const decode = (text: string) => Effect.succeed(text);
      const resource = (filesystem: FileSystem.FileSystem) =>
        makeCachedFetch({
          cache: { fs: filesystem, path, root },
          client,
          url: `${server.url}/index.json`,
          bodyFile: "index.json",
          stateFile,
          decode,
          offline: Effect.succeed(false),
        });
      const first = yield* resource(gated);
      const one = `${server.url}/bundle-one`;
      const two = `${server.url}/bundle-two`;
      const left = yield* first.get(one, decode).pipe(Effect.forkChild);
      yield* Deferred.await(stagedFirst);
      expect(yield* first.get(two, decode)).toEqual(Option.none());
      expect(yield* Fiber.join(left)).toEqual(Option.none());
      expect(server.requests).toEqual(["/bundle-one", "/bundle-two"]);

      const next = yield* resource(fs);
      expect(yield* next.get(one, decode)).toEqual(Option.none());
      expect(yield* next.get(two, decode)).toEqual(Option.none());
      expect(server.requests).toEqual(["/bundle-one", "/bundle-two"]);
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetLayer))),
  ),
);
