import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it } from "@effect/vitest";
import { type IndexEntry, RegistryIndex } from "@steamfield/stacks-format";
import { Clock, Effect, Fiber, Schema } from "effect";
import { Command } from "effect/cli";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { cli } from "../src/cli";
import { INDEX_REFRESH_DEADLINE_MS } from "../src/constants";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { AddResult } from "../src/schemas/add";
import { ListResult } from "../src/schemas/list";
import { VERSION } from "../src/version";
import { bundleFile, digestOf, keyId, rawBundle } from "./fixtures/index/harness";
import { runCli, tempDir } from "./helpers/cli";
import { heldServer } from "./helpers/held-server";
import { minimal, writeEntry } from "./helpers/registry";
import { environment, keys, publish, success } from "./helpers/remote-index";

const fixture = Effect.fn("test.scopeFixture")(function* () {
  const { path: home } = yield* Effect.acquireRelease(Effect.sync(tempDir), ({ cleanup }) =>
    Effect.sync(cleanup),
  );
  return { home, bundled: join(home, "bundled"), source: join(home, "source") };
});

function entry(root: string, kind: IndexEntry["kind"], id: string, body: string) {
  return writeEntry({ root, kind, dir: id, frontmatter: minimal(kind, id), body });
}

const serve = Effect.fn("test.serveScopeFixture")(function* (
  { home, bundled, source }: Effect.Success<ReturnType<typeof fixture>>,
  entries: ReadonlyArray<Pick<IndexEntry, "id" | "kind">>,
  hold: (path: string) => boolean,
) {
  const root = join(home, "published");
  const refs = yield* Effect.promise(() =>
    Promise.all(
      entries.map(async ({ id, kind }) => {
        const bundle = rawBundle(source, kind, id);
        const ref = { id, kind, digest: await digestOf(bundle) };
        const file = bundleFile(root, ref);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(bundle));
        return {
          ...ref,
          schemaVersion: 1,
          name: id,
          description: id,
          tags: [],
          ...(kind === "stack" ? { composition: {} } : {}),
        };
      }),
    ),
  );
  const index = Schema.decodeUnknownSync(RegistryIndex)({
    formatVersion: 1,
    minCli: VERSION,
    generatedAt: "2026-10-28T00:00:00Z",
    commit: "1".repeat(40),
    entries: refs,
  });
  publish(root, { keyId, signature: "", payload: "" }, index);
  const server = yield* Effect.acquireRelease(
    Effect.promise(() => heldServer(root, hold)),
    (server) => Effect.promise(() => server.close()),
  );
  const clock = yield* Clock.Clock;
  const remote = RemoteIndex.layer({ keys });
  return {
    server,
    run: (words: string[]) => {
      const args = [...words, "--json"];
      return Effect.promise((signal) =>
        runCli(args, {
          home,
          env: environment(home),
          build: { officialIndexUrl: `${server.url}/v1/index.json` },
          clock,
          signal,
          host: { registry: bundled },
          program: Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
            Effect.provide(remote),
          ),
        }),
      );
    },
  };
});

it.effect("add can use an index-only fragment for the selected project", () =>
  Effect.gen(function* () {
    const paths = yield* fixture();
    entry(paths.bundled, "stack", "base", "# Bundled stack\n");
    const fragment = entry(paths.source, "fragment", "index-tools", "# Index fragment\n");
    mkdirSync(join(fragment, "files"));
    writeFileSync(join(fragment, "files", "index-tool.txt"), "from the verified index\n");
    const { run } = yield* serve(paths, [{ kind: "fragment", id: "index-tools" }], () => false);
    const project = join(paths.home, "project");
    success(yield* run(["new", "base", project, "--no-launch"]));
    const result = yield* run(["add", "index-tools", "--dir", project, "--no-launch"]);
    success(result);
    expect(Schema.decodeUnknownSync(AddResult)(JSON.parse(result.stdout)).added).toEqual([
      "index-tools",
    ]);
    expect(readFileSync(join(project, "index-tool.txt"), "utf8")).toBe("from the verified index\n");
  }),
);

it.effect("list closes an unfinished index download when its registry scope ends", () =>
  Effect.gen(function* () {
    const paths = yield* fixture();
    const entries = Array.from({ length: 17 }, (_, n) => {
      const id = `fixture-${String(n).padStart(2, "0")}`;
      entry(paths.bundled, "stack", id, "# Bundled stack\n");
      entry(paths.source, "stack", id, "# Index stack\n");
      return { kind: "stack", id } satisfies Pick<IndexEntry, "kind" | "id">;
    });
    const { server, run } = yield* serve(paths, entries, (path) => path.startsWith("/v1/entries/"));
    const list = yield* run(["list"]).pipe(Effect.forkChild);
    for (let wave = 0; wave < 2; wave++) {
      yield* Effect.promise(() => expect.poll(() => server.pending()).toHaveLength(8));
      yield* TestClock.adjust(1_100);
      server.release();
    }
    yield* Effect.promise(() => expect.poll(() => server.pending()).toHaveLength(1));
    yield* TestClock.adjust(INDEX_REFRESH_DEADLINE_MS - 2_200 + 1);
    const result = yield* Fiber.join(list);
    success(result);
    const { entries: listed } = Schema.decodeUnknownSync(ListResult)(JSON.parse(result.stdout));
    expect(listed.map(({ origin }) => origin)).toEqual([
      ...Array.from({ length: 16 }, () => "index"),
      "bundled",
    ]);
    yield* Effect.promise(() => expect.poll(() => server.pending()).toEqual([]));
  }),
);
