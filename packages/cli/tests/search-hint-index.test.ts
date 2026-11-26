import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { type RegistryIndex, type SearchHit, SearchResponse } from "@steamfield/stacks-format";
import { Clock, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeAll, expect } from "vitest";
import { CACHE_FRESHNESS_MS } from "../src/constants";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { VERSION } from "../src/version";
import { digestOf, keyId, rawBundle } from "./fixtures/index/harness";
import { emptyRegistry, smallRegistry } from "./helpers/registry";
import {
  publish,
  type RemoteServer,
  remoteCli,
  remoteLayer,
  remoteServer,
  success,
} from "./helpers/remote-index";
import { apiOptions, decoded, officialHit, response } from "./helpers/search-api";
import { workspace } from "./helpers/verify";

const space = workspace();
const invocation = "npx -y stacks@0.15.0";
const indexPath = "/v1/index.json";
const hit = officialHit("go-api");
const fragment = officialHit("editor-config", { kind: "fragment" });
const unrelated = officialHit("bun-web");
let indexBody: RegistryIndex;

beforeAll(async () => {
  indexBody = {
    formatVersion: 1,
    minCli: VERSION,
    generatedAt: "2026-10-28T00:00:00Z",
    commit: "1".repeat(40),
    entries: await Promise.all(
      [hit, unrelated].map(async ({ kind, id, name, summary }) => ({
        kind,
        id,
        name,
        description: summary,
        tags: [],
        schemaVersion: 1,
        composition: {},
        digest: await digestOf(rawBundle(smallRegistry, kind, id)),
      })),
    ),
  };
});
afterEach(() => space.release());

const readIndex = Effect.gen(function* () {
  const remote = yield* RemoteIndex;
  return { index: Option.getOrUndefined(yield* remote.current), status: yield* remote.status };
});

type CacheState =
  | "none"
  | "present"
  | "missing"
  | "unsupported"
  | "unsupported-stale"
  | "invalid-stale";

const seed = Effect.fn("test.seedSearchIndex")(function* (
  home: string,
  published: string,
  server: RemoteServer,
  state: Exclude<CacheState, "none">,
) {
  const read = () =>
    Effect.promise(() => remoteLayer(home, server)).pipe(
      Effect.flatMap((layer) => readIndex.pipe(Effect.provide(layer))),
    );
  const envelope = { keyId, signature: "", payload: "" };
  const valid = {
    ...indexBody,
    entries:
      state === "missing" ? indexBody.entries.filter(({ id }) => id !== hit.id) : indexBody.entries,
  };
  const unsupported = { ...valid, minCli: "999.0.0" };
  publish(published, envelope, state === "unsupported" ? unsupported : valid);
  const seeded = yield* read();
  expect(seeded.index?.entries).toEqual(state === "unsupported" ? undefined : valid.entries);
  expect(seeded.status.lastOutcome).toBe(state === "unsupported" ? "unsupported" : "ok");
  expect(server.requests).toEqual([indexPath]);
  if (state !== "unsupported-stale" && state !== "invalid-stale") return;
  yield* TestClock.adjust(CACHE_FRESHNESS_MS);
  if (state === "unsupported-stale") publish(published, envelope, unsupported);
  else writeFileSync(join(published, "v1/index.json"), "{");
  const stale = yield* read();
  expect(stale.index?.entries).toEqual(valid.entries);
  expect(stale.status.lastOutcome).toBe(state === "unsupported-stale" ? "unsupported" : "invalid");
  expect(server.requests).toEqual([indexPath, indexPath]);
});

function serveSearch(published: string, hit: SearchHit) {
  mkdirSync(join(published, "v1"), { recursive: true });
  const hits = [{ ...hit, evidence: { lastRun: null } }];
  const wire = Schema.encodeUnknownSync(SearchResponse)(
    hit.kind === "stack" ? response(hits) : response([], hits),
  );
  writeFileSync(join(published, "v1/search"), JSON.stringify(wire));
  return remoteServer(published);
}

const cases: ReadonlyArray<{
  name: string;
  state: CacheState;
  update: boolean;
  selected?: SearchHit;
}> = [
  { name: "no cached index", state: "none", update: false },
  { name: "a cached index containing the API hit", state: "present", update: false },
  { name: "a cached index missing the API hit", state: "missing", update: true },
  {
    name: "an unsupported index response with the hit in the cache",
    state: "unsupported-stale",
    update: true,
  },
  { name: "an unsupported first index response", state: "unsupported", update: true },
  {
    name: "an invalid index response with the hit in the cache",
    state: "invalid-stale",
    update: false,
  },
  {
    name: "an API fragment missing from a nonempty cached index",
    state: "missing",
    update: true,
    selected: fragment,
  },
];

for (const { name, state, update, selected = hit } of cases) {
  it.effect(`search chooses the next action with ${name}`, () =>
    Effect.gen(function* () {
      const home = space.dir();
      const published = join(home, "published");
      const server = yield* Effect.acquireRelease(
        Effect.promise(() => serveSearch(published, selected)),
        (server) => Effect.promise(() => server.close()),
      );
      if (state !== "none") yield* seed(home, published, server, state);
      const seededRequests = server.requests.length;
      const clock = yield* Clock.Clock;
      const options = apiOptions(home, server.url);
      const host = { ...options.host, registry: emptyRegistry, invocation };
      const run = (args: string[]) =>
        Effect.promise((signal) =>
          remoteCli(["search", selected.id, ...args], {
            ...options,
            home,
            server,
            host,
            clock,
            signal,
          }),
        );
      const jsonOutput = yield* run(["--json"]);
      expect(decoded(jsonOutput)).toMatchObject({
        ranking: "api",
        remote: "used",
        ...(selected.kind === "stack" ? { stacks: [selected] } : { fragments: [selected] }),
      });
      expect(JSON.parse(jsonOutput.stdout)).not.toHaveProperty("next");
      const text = yield* run([]);
      success(text);
      expect(text.stdout).toContain(`${selected.kind} ${selected.id}`);
      const hints = text.stdout.split("\n").filter((line) => line.startsWith("Next: "));
      if (update) {
        expect(hints).toHaveLength(1);
        expect(hints[0]).toMatch(
          new RegExp(`^Next: ${invocation.replaceAll(".", "\\.")} update\\b`),
        );
        expect(hints[0]).not.toMatch(new RegExp(`\\b(?:show|new|add) ${selected.id}\\b`));
      } else {
        expect(hints).toEqual([
          `Next: ${invocation} show ${selected.id}, then ${invocation} new ${selected.id} <dir>.`,
        ]);
      }
      expect(server.requests.slice(seededRequests)).toEqual(["/v1/search", "/v1/search"]);
    }),
  );
}
