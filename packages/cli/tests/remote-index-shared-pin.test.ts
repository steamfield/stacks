import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { type IndexEntry, RegistryIndex } from "@steamfield/stacks-format";
import { Deferred, Effect, FileSystem, Layer, Schema } from "effect";
import { expect } from "vitest";
import { AppConfig } from "../src/config";
import { Registry } from "../src/core/registry/registry";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { NetLayer } from "../src/platform/net";
import { VERSION } from "../src/version";
import { bundleFile, digestOf, keyId, rawBundle } from "./fixtures/index/harness";
import { tempDir } from "./helpers/cli";
import { heldServer } from "./helpers/held-server";
import { minimal, writeEntry } from "./helpers/registry";
import { environment, keys, publish } from "./helpers/remote-index";

async function writeBundle(
  published: string,
  registry: string,
  kind: IndexEntry["kind"],
  id: string,
) {
  const bundle = rawBundle(registry, kind, id);
  const ref = { kind, id, digest: await digestOf(bundle) };
  const file = bundleFile(published, ref);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(bundle));
  return ref;
}

it.live("lists both index-only stacks sharing a pin when the persistent cache is blocked", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { path: home } = yield* Effect.acquireRelease(Effect.sync(tempDir), ({ cleanup }) =>
        Effect.sync(cleanup),
      );
      const source = join(home, "source");
      const bundled = join(home, "bundled");
      const published = join(home, "published");
      mkdirSync(bundled);
      writeFileSync(join(home, "cache"), "blocks XDG_CACHE_HOME");
      const ids = ["service-one", "service-two"];
      const shared = "shared-tools";
      writeEntry({
        root: source,
        kind: "fragment",
        dir: shared,
        frontmatter: minimal("fragment", shared),
      });
      for (const id of ids) {
        writeEntry({
          root: source,
          kind: "stack",
          dir: id,
          frontmatter: minimal("stack", id, `fragments:\n  required: [${shared}]`),
        });
      }
      const pin = yield* Effect.promise(() => writeBundle(published, source, "fragment", shared));
      const stacks = yield* Effect.promise(() =>
        Promise.all(ids.map((id) => writeBundle(published, source, "stack", id))),
      );
      const index = Schema.decodeUnknownSync(RegistryIndex)({
        formatVersion: 1,
        minCli: VERSION,
        generatedAt: "2026-10-28T00:00:00Z",
        commit: "1".repeat(40),
        entries: stacks.map((ref) => ({
          ...ref,
          name: ref.id,
          description: ref.id,
          schemaVersion: 1,
          tags: [],
          composition: { [shared]: pin.digest },
        })),
      });
      publish(published, { keyId, signature: "", payload: "" }, index);
      const server = yield* Effect.acquireRelease(
        Effect.promise(() => heldServer(published, () => false)),
        (server) => Effect.promise(() => server.close()),
      );
      const fs = yield* FileSystem.FileSystem;
      const secondWrite = yield* Deferred.make<void>();
      let firstWriting = false;
      const gated: FileSystem.FileSystem = {
        ...fs,
        writeFile: (file, bytes, options) => {
          const write = fs.writeFile(file, bytes, options);
          if (!file.endsWith(`${sep}${pin.digest}${sep}FRAGMENT.md`)) return write;
          return Effect.suspend(() => {
            if (firstWriting)
              return write.pipe(Effect.ensuring(Deferred.succeed(secondWrite, undefined)));
            firstWriting = true;
            // In the concurrent case, finish the later exclusive write first.
            return Deferred.await(secondWrite).pipe(
              Effect.timeoutOption("3 seconds"),
              Effect.andThen(write),
            );
          });
        },
      };
      const registry = Registry.layer([{ origin: "bundled", path: bundled, remote: true }]).pipe(
        Layer.provide(RemoteIndex.layer({ keys })),
        Layer.provide(
          AppConfig.memory({
            ...environment(home),
            STACKS_INDEX_URL: `${server.url}/v1/index.json`,
          }),
        ),
      );
      const rows = yield* Registry.pipe(
        Effect.flatMap((registry) => registry.all),
        Effect.provide(registry),
        Effect.provideService(FileSystem.FileSystem, gated),
      );
      expect(rows.map(({ id, origin }) => ({ id, origin }))).toEqual(
        ids.map((id) => ({ id, origin: "index" })),
      );
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetLayer))),
  ),
);
