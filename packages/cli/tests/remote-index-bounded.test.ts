import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { type IndexEntry, RegistryIndex } from "@steamfield/stacks-format";
import { Clock, Effect, Fiber, Layer, Schema } from "effect";
import { Command } from "effect/cli";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { afterAll, beforeAll, expect } from "vitest";
import { SOURCE_BUILD } from "../src/build";
import { cli } from "../src/cli";
import { AppConfig } from "../src/config";
import { CACHE_FRESHNESS_MS, INDEX_REFRESH_DEADLINE_MS } from "../src/constants";
import { Registry } from "../src/core/registry/registry";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { NetLayer } from "../src/platform/net";
import { ListResult } from "../src/schemas/list";
import { VERSION } from "../src/version";
import { bundleFile, digestOf, keyId, rawBundle } from "./fixtures/index/harness";
import { runCli, tempDir } from "./helpers/cli";
import { type HeldServer, heldServer } from "./helpers/held-server";
import { copyEntry, minimal, writeEntry } from "./helpers/registry";
import { environment, keys, publish, success } from "./helpers/remote-index";

type Pin = Pick<IndexEntry, "kind" | "id" | "digest">;
type Published = { root: string; bundled: string; entries: IndexEntry[] };
const indexPath = "/v1/index.json";
const bundlePath = (entry: Pin) => `/${bundleFile("", entry)}`;
const isBundle = (path: string) => path.startsWith("/v1/entries/");
const slots = 8;
const waveTime = 1_100;
const slack = 10;
const cutoff = INDEX_REFRESH_DEADLINE_MS + slack;
const scratch = tempDir();
let plain: Published;
let workspaces: Published;
let partlyBundled: string;

function writeStack(root: string, id: string, body: string, extra = "") {
  writeEntry({ root, kind: "stack", dir: id, frontmatter: minimal("stack", id, extra), body });
}

async function pin(published: string, source: string, kind: Pin["kind"], id: string) {
  const bundle = rawBundle(source, kind, id);
  const entry = { kind, id, digest: await digestOf(bundle) };
  const file = bundleFile(published, entry);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(bundle));
  return entry;
}

async function workspacePins(root: string, source: string, bundled: string, id: string) {
  const fragment = `${id}-tools`;
  const part = `${id}-api`;
  writeStack(source, part, "# Index part\n");
  writeStack(bundled, part, "# Bundled part\n");
  for (const [registry, body] of [
    [source, "# Index fragment\n"],
    [bundled, "# Bundled fragment\n"],
  ] as const)
    writeEntry({
      root: registry,
      kind: "fragment",
      dir: fragment,
      frontmatter: minimal("fragment", fragment),
      body,
    });
  const extra = `parts:
  - { name: backend, role: api, stack: ${part} }
fragments:
  required: [${fragment}]`;
  return {
    extra,
    parts: { backend: { stack: part, digest: (await pin(root, source, "stack", part)).digest } },
    composition: { [fragment]: (await pin(root, source, "fragment", fragment)).digest },
  };
}

async function catalog(parent: string, workspace: boolean): Promise<Published> {
  const root = join(parent, "published");
  const source = join(parent, "remote-registry");
  const bundled = join(parent, "bundled");
  const entries: IndexEntry[] = [];
  // The mixed fixture needs more than two waves' worth of each kind of origin.
  const size = workspace ? 3 * slots + 1 : 4 * slots + 2;
  for (let n = 0; n < size; n++) {
    const id = `fixture-${String(n).padStart(2, "0")}`;
    const { extra, ...pins } = workspace
      ? await workspacePins(root, source, bundled, id)
      : { extra: "", composition: {} };
    writeStack(source, id, "# Index copy\n", extra);
    writeStack(bundled, id, "# Bundled copy\n", extra);
    entries.push({
      ...(await pin(root, source, "stack", id)),
      schemaVersion: 1,
      name: `${id} name`,
      description: `${id} description.`,
      tags: [],
      ...pins,
    });
  }
  const index = Schema.decodeUnknownSync(RegistryIndex)({
    formatVersion: 1,
    minCli: VERSION,
    generatedAt: "2026-10-28T00:00:00Z",
    commit: "1".repeat(40),
    entries,
  });
  publish(root, { keyId, signature: "", payload: "" }, index);
  return { root, bundled, entries };
}

beforeAll(async () => {
  const root = realpathSync(scratch.path);
  [plain, workspaces] = await Promise.all([
    catalog(join(root, "plain"), false),
    catalog(join(root, "workspaces"), true),
  ]);
  partlyBundled = join(root, "partly-bundled");
  for (const { id } of plain.entries.slice(0, plain.entries.length / 2))
    copyEntry(plain.bundled, partlyBundled, "stacks", id);
});
afterAll(() => scratch.cleanup());

function setup(fixture: Published, hold: (path: string) => boolean = isBundle) {
  return Effect.gen(function* () {
    const { path } = yield* Effect.acquireRelease(Effect.sync(tempDir), ({ cleanup }) =>
      Effect.sync(cleanup),
    );
    const home = realpathSync(path);
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => heldServer(fixture.root, hold)),
      (server) => Effect.promise(() => server.close()),
    );
    const indexUrl = `${server.url}${indexPath}`;
    const env = environment(home);
    const build = { officialIndexUrl: indexUrl };
    const remote = RemoteIndex.layer({ keys });
    const clock = yield* Clock.Clock;
    const started = new Map<string, number>();
    const http = Layer.effect(
      HttpClient.HttpClient,
      Effect.map(
        HttpClient.HttpClient,
        HttpClient.mapRequest((request) => {
          started.set(new URL(request.url).pathname, clock.currentTimeMillisUnsafe());
          return request;
        }),
      ),
    ).pipe(Layer.provide(NetLayer));
    const args = ["list", "--json"];
    return {
      server,
      started,
      list: (registry = fixture.bundled) =>
        Effect.promise((signal) =>
          runCli(args, {
            home,
            env,
            build,
            signal,
            clock,
            http,
            host: { registry },
            program: Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
              Effect.provide(remote),
            ),
          }),
        ),
      registry: Registry.layer([{ origin: "bundled", path: fixture.bundled, remote: true }]).pipe(
        Layer.provide(remote),
        Layer.provide(AppConfig.memory(env, { ...SOURCE_BUILD, ...build })),
        Layer.provide(http),
        Layer.provide(NodeServices.layer),
      ),
    };
  });
}

function listed(result: Awaited<ReturnType<typeof runCli>>) {
  success(result);
  const value = Schema.decodeUnknownSync(ListResult)(JSON.parse(result.stdout));
  expect(value.rejected).toEqual([]);
  return value.entries;
}

function expectedRows(fixture: Published, origin: "bundled" | "index") {
  return fixture.entries.map(({ id, kind }) => ({ id, kind, origin }));
}

const rows = (
  items: ReadonlyArray<Pick<ListResult["entries"][number], "id" | "kind" | "origin">>,
) => items.map(({ id, kind, origin }) => ({ id, kind, origin }));

function joinedByDeadline<A, E>(fiber: Fiber.Fiber<A, E>) {
  return Effect.gen(function* () {
    // Poll only to let real filesystem/transport completion drain at the frozen TestClock time.
    yield* Effect.promise(() =>
      expect
        .poll(() => fiber.pollUnsafe() !== undefined, {
          message: "registry read is still pending after advancing past the shared deadline",
        })
        .toBe(true),
    );
    return yield* Fiber.join(fiber);
  });
}

const pending = (server: HeldServer, match: (path: string) => boolean = isBundle) =>
  Effect.promise(() => expect.poll(() => server.pending().some(match)).toBe(true));

type RequestTiming = { server: HeldServer; started: ReadonlyMap<string, number> };

/** Verify when the client sent the request so socket delivery cannot put it in the wrong wave. */
const stageLateBundle = Effect.fn("test.stageLateBundle")(function* ({
  server,
  started,
}: RequestTiming) {
  let at = yield* Clock.currentTimeMillis;
  yield* pending(server, (path) => started.get(path) === at);
  for (let wave = 0; wave < 2; wave++) {
    yield* TestClock.adjust(waveTime);
    at += waveTime;
    server.release();
    yield* pending(server, (path) => started.get(path) === at);
  }
  const held = server.pending().find((path) => started.get(path) === at);
  if (!held) throw new Error("No held bundle from the last wave");
  return held;
});

function entryAt(fixture: Published, path: string | undefined) {
  const entry = fixture.entries.find((item) => bundlePath(item) === path);
  if (!entry) throw new Error(`Missing fixture entry for ${path}`);
  return entry;
}

const fullWave = (server: HeldServer) =>
  Effect.promise(() =>
    expect
      .poll(() => server.pending().length, {
        message: "a drifted registry should resolve eight entries concurrently",
      })
      .toBeGreaterThanOrEqual(slots),
  );

it.effect("list returns all bundled rows by the deadline when every download stalls", () =>
  Effect.gen(function* () {
    const { list, server } = yield* setup(plain);
    const running = yield* list().pipe(Effect.forkChild);
    yield* pending(server);
    yield* TestClock.adjust(cutoff);
    expect(rows(listed(yield* joinedByDeadline(running)))).toEqual(expectedRows(plain, "bundled"));
  }),
);

it.effect("list keeps at most eight bundle requests open across successive waves", () =>
  Effect.gen(function* () {
    const { list, server } = yield* setup(plain);
    const running = yield* list().pipe(Effect.forkChild);
    for (let wave = 0; wave < 3; wave++) {
      yield* fullWave(server);
      server.release();
    }
    server.serveRemaining();
    expect(rows(listed(yield* Fiber.join(running)))).toEqual(expectedRows(plain, "index"));
    expect(server.peakOpen()).toBe(slots);
  }),
);

it.effect(
  "a later get reads the original held index download after all used the bundled copy",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup(plain);
      const { registry, server } = fixture;
      yield* Effect.gen(function* () {
        const service = yield* Registry;
        const running = yield* service.all.pipe(Effect.forkChild);
        const held = yield* stageLateBundle(fixture);
        const entry = entryAt(plain, held);
        yield* TestClock.adjust(INDEX_REFRESH_DEADLINE_MS - 2 * waveTime - 1);
        expect(running.pollUnsafe()).toBeUndefined();
        expect(server.pending()).toContain(held);
        yield* TestClock.adjust(slack + 1);
        const result = yield* joinedByDeadline(running);
        expect(result.find(({ id }) => id === entry.id)?.origin).toBe("bundled");
        expect(server.pending()).toContain(held);
        const get = yield* service
          .get("stack", entry.id)
          .pipe(Effect.forkChild({ startImmediately: true }));
        expect(get.pollUnsafe()).toBeUndefined();
        server.release((path) => path === held);
        const resolved = yield* Fiber.join(get);
        expect(resolved).toMatchObject({ origin: "index", indexEntry: { digest: entry.digest } });
        expect(server.requests.filter((path) => path === held)).toHaveLength(1);
      }).pipe(Effect.provide(registry));
    }),
);

it.effect("list waits past the shared deadline for entries that have no bundled copy", () =>
  Effect.gen(function* () {
    const bundledPaths = new Set(plain.entries.slice(0, plain.entries.length / 2).map(bundlePath));
    let held: ReadonlySet<string> | undefined;
    const { list, server } = yield* setup(
      plain,
      (path) => isBundle(path) && (held === undefined || held.has(path)),
    );
    const running = yield* list(partlyBundled).pipe(Effect.forkChild);
    for (let wave = 0; wave < 2; wave++) {
      yield* fullWave(server);
      yield* TestClock.adjust(waveTime);
      server.release();
    }
    const { bundled, indexOnly } = yield* holdMixedWave(server, bundledPaths);
    held = new Set([bundled, indexOnly]);
    expect(server.peakOpen()).toBe(slots);
    yield* TestClock.adjust(cutoff - 2 * waveTime);
    expect(server.pending()).toEqual(expect.arrayContaining([bundled, indexOnly]));
    expect(running.pollUnsafe()).toBeUndefined();
    server.release((path) => path === indexOnly);
    const entries = listed(yield* joinedByDeadline(running));
    expect(entries.map(({ id }) => id)).toEqual(plain.entries.map(({ id }) => id));
    const fallback = entryAt(plain, bundled);
    expect(entries.find(({ id }) => id === fallback.id)?.origin).toBe("bundled");
    for (const row of entries.filter(
      ({ id }) =>
        !plain.entries.some((entry) => entry.id === id && bundledPaths.has(bundlePath(entry))),
    ))
      expect(row.origin).toBe("index");
  }),
);

/** Let the queue advance at one virtual time until one request of each origin is held. */
const holdMixedWave = Effect.fn("test.holdMixedWave")(function* (
  server: HeldServer,
  bundledPaths: ReadonlySet<string>,
) {
  let bundled: string | undefined;
  let indexOnly: string | undefined;
  yield* Effect.promise(() =>
    expect
      .poll(() => {
        const open = server.pending();
        bundled ??= open.find((path) => bundledPaths.has(path));
        indexOnly ??= open.find((path) => !bundledPaths.has(path));
        server.release((path) => path !== bundled && path !== indexOnly);
        return bundled !== undefined && indexOnly !== undefined;
      })
      .toBe(true),
  );
  if (!bundled || !indexOnly) throw new Error("Missing mixed-origin bundle wave");
  return { bundled, indexOnly };
});

for (const kind of ["fragment", "part"] as const) {
  it.effect(`a workspace's ${kind} pin shares the all deadline and stays available to get`, () =>
    Effect.gen(function* () {
      const roots = new Set(workspaces.entries.map(bundlePath));
      const pinsToHold = new Set<string>();
      const fixture = yield* setup(workspaces, (path) => roots.has(path) || pinsToHold.has(path));
      const { registry, server } = fixture;
      yield* Effect.gen(function* () {
        const service = yield* Registry;
        const running = yield* service.all.pipe(Effect.forkChild);
        const held = yield* stageLateBundle(fixture);
        const workspace = entryAt(workspaces, held);
        const pin = workspacePin(workspace, kind);
        const pinPath = bundlePath(pin);
        pinsToHold.add(pinPath);
        server.release((path) => path === held);
        yield* pending(server, (path) => path === pinPath);
        yield* TestClock.adjust(cutoff - 2 * waveTime);
        const entries = yield* joinedByDeadline(running);
        expect(entries.find(({ id }) => id === workspace.id)?.origin).toBe("bundled");
        expect(server.pending()).toContain(pinPath);
        const get = yield* service
          .get("stack", workspace.id)
          .pipe(Effect.forkChild({ startImmediately: true }));
        expect(get.pollUnsafe()).toBeUndefined();
        server.release((path) => path === pinPath);
        const resolved = yield* Fiber.join(get);
        const dependency =
          kind === "part"
            ? resolved.partEntries?.backend
            : resolved.composition?.find(({ id }) => id === pin.id);
        expect(resolved.origin).toBe("index");
        expect(dependency).toMatchObject({ origin: "index", indexEntry: { digest: pin.digest } });
        expect(server.requests.filter((path) => path === pinPath)).toHaveLength(1);
      }).pipe(Effect.provide(registry));
    }),
  );
}

function workspacePin(entry: IndexEntry, kind: "fragment" | "part"): Pin {
  if (kind === "part" && entry.parts?.backend) {
    const { stack: id, digest } = entry.parts.backend;
    return { kind: "stack", id, digest };
  }
  const fragment = Object.entries(entry.composition ?? {})[0];
  if (kind === "fragment" && fragment) {
    const [id, digest] = fragment;
    return { kind, id, digest };
  }
  throw new Error(`Missing ${kind} pin for ${entry.id}`);
}

it.effect("a second all in the same invocation uses the first all deadline", () =>
  Effect.gen(function* () {
    const fixture = yield* setup(plain);
    const { registry, server, started } = fixture;
    yield* Effect.gen(function* () {
      const service = yield* Registry;
      const first = yield* service.all.pipe(Effect.forkChild);
      const held = yield* stageLateBundle(fixture);
      const entry = entryAt(plain, held);
      yield* TestClock.adjust(cutoff - 2 * waveTime);
      const original = yield* joinedByDeadline(first);
      const anotherLate = (path: string) =>
        path !== held && started.get(path) === started.get(held);
      yield* pending(server, anotherLate);
      const stillHeld = entryAt(plain, server.pending().find(anotherLate));
      expect(original.find(({ id }) => id === entry.id)?.origin).toBe("bundled");
      expect(original.find(({ id }) => id === stillHeld.id)?.origin).toBe("bundled");
      server.release((path) => path === held);
      expect((yield* service.get("stack", entry.id)).origin).toBe("index");
      const second = yield* service.all.pipe(Effect.forkChild);
      const repeated = yield* joinedByDeadline(second);
      expect(repeated.find(({ id }) => id === entry.id)?.origin).toBe("index");
      expect(repeated.find(({ id }) => id === stillHeld.id)?.origin).toBe("bundled");
    }).pipe(Effect.provide(registry));
  }),
);

it.effect("list reuses the last successful index fetch until the 24-hour cache expires", () =>
  Effect.gen(function* () {
    const { list, server } = yield* setup(plain, () => false);
    const first = listed(yield* list());
    expect(rows(first)).toEqual(expectedRows(plain, "index"));
    const indexRequests = () => server.requests.filter((path) => path === indexPath);
    expect(indexRequests()).toHaveLength(1);
    yield* TestClock.adjust(CACHE_FRESHNESS_MS - 1);
    expect(listed(yield* list())).toEqual(first);
    expect(indexRequests()).toHaveLength(1);
  }),
);
