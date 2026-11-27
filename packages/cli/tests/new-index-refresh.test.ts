import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { CACHE_FRESHNESS_MS, INDEX_REFRESH_DEADLINE_MS } from "../src/constants";
import { NewResult } from "../src/schemas/new";
import { ShowReport } from "../src/schemas/show";
import { heldServer } from "./helpers/held-server";
import { pickerTTY } from "./helpers/picker";
import {
  type CommandResult,
  fixtureIndexPath,
  indexCommandFixture,
  indexRefreshFixture,
  success,
  writeFixtureBundle,
  writeFixtureEntry,
  writeFixtureIndex,
} from "./helpers/remote-index";
import { choose, numberedRows, terminalScript } from "./helpers/scripted-terminal";

const newArgs = ["new", "sample", "project", "--sandbox", "--no-launch"];
const jsonArgs = [...newArgs, "--json"];
const indexOnly = { kind: "stack", id: "index-only-stack" } as const;
const etag = '"cached-index"';

function decoded(result: CommandResult) {
  success(result);
  return Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout), {
    onExcessProperty: "error",
  });
}

const warnings = (value: NewResult) =>
  value.warnings.filter(({ code }) => code === "index_fallback");

const publishIndexOnly = Effect.fn("test.publishIndexOnly")(function* ({
  published,
  upstream,
  stack,
}: Effect.Success<typeof indexRefreshFixture>) {
  writeFixtureEntry(upstream, indexOnly, "from the index-only stack\n");
  const entry = yield* Effect.promise(() => writeFixtureBundle(published, upstream, indexOnly));
  writeFixtureIndex(published, [stack, entry], { commit: "2".repeat(40) });
});

it.effect("new refreshes a cache under 24 hours old and composes the changed files", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    fixture.server.setEtag(etag);
    yield* fixture.list;
    yield* TestClock.adjust(CACHE_FRESHNESS_MS - 1);
    writeFixtureEntry(fixture.upstream, fixture.stack, "sample from the new index\n");
    const changed = yield* Effect.promise(() =>
      writeFixtureBundle(fixture.published, fixture.upstream, fixture.stack),
    );
    writeFixtureIndex(fixture.published, [changed], {
      commit: "2".repeat(40),
      generatedAt: "2026-11-18T09:15:00Z",
    });
    fixture.server.setEtag('"new-index"');

    const result = decoded(yield* fixture.run(jsonArgs));
    expect(readFileSync(join(result.project, "sample.txt"), "utf8")).toBe(
      "sample from the new index\n",
    );
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
    expect(fixture.headers()[1]?.["if-none-match"]).toBe(etag);
    expect(warnings(result)).toEqual([]);
  }),
);

it.effect("new makes one conditional index request across a 304 and later registry reads", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureEntry(fixture.upstream, fixture.stack, "sample confirmed by the index\n");
    const indexed = yield* Effect.promise(() =>
      writeFixtureBundle(fixture.published, fixture.upstream, fixture.stack),
    );
    writeFixtureIndex(fixture.published, [indexed]);
    fixture.server.setEtag(etag);
    yield* fixture.list;

    const result = decoded(yield* fixture.run(jsonArgs));
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
    expect(fixture.headers()[1]?.["if-none-match"]).toBe(etag);
    expect(readFileSync(join(result.project, "sample.txt"), "utf8")).toBe(
      "sample confirmed by the index\n",
    );
    expect(warnings(result)).toEqual([]);
  }),
);

it.effect("new uses an index response released just before the refresh deadline", () =>
  Effect.gen(function* () {
    const fixture = yield* indexCommandFixture;
    writeFixtureEntry(fixture.upstream, fixture.stack, "sample from the slow index\n");
    const indexed = yield* Effect.promise(() =>
      writeFixtureBundle(fixture.published, fixture.upstream, fixture.stack),
    );
    writeFixtureIndex(fixture.published, [indexed]);
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => heldServer(fixture.published, (path) => path === fixtureIndexPath)),
      (server) => Effect.promise(() => server.close()),
    );
    const running = yield* fixture.connect(server)(jsonArgs).pipe(Effect.forkChild);
    yield* Effect.promise(() => expect.poll(() => server.pending()).toEqual([fixtureIndexPath]));
    yield* TestClock.adjust(INDEX_REFRESH_DEADLINE_MS - 1);
    server.release();

    const result = decoded(yield* Fiber.join(running));
    expect(readFileSync(join(result.project, "sample.txt"), "utf8")).toBe(
      "sample from the slow index\n",
    );
    expect(warnings(result)).toEqual([]);
    expect(server.requests.filter((path) => path === fixtureIndexPath)).toEqual([fixtureIndexPath]);
  }),
);

it.effect("new requests the index through an active backoff left by list", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    fixture.server.mode("not_found");
    yield* fixture.list;
    expect(yield* fixture.status).toMatchObject({
      lastOutcome: "not_found",
      backoffUntil: expect.any(String),
    });
    expect(fixture.requests()).toEqual([fixtureIndexPath]);
    fixture.server.mode("files");

    const result = decoded(yield* fixture.run(jsonArgs));
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
    expect(warnings(result)).toEqual([]);
  }),
);

it.effect("new creates an index-only stack that was missing from the fresh cache", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    yield* fixture.list;
    yield* publishIndexOnly(fixture);

    const result = decoded(yield* fixture.run(["new", indexOnly.id, ...jsonArgs.slice(2)]));
    expect(result.stack).toBe(indexOnly.id);
    expect(readFileSync(join(result.project, `${indexOnly.id}.txt`), "utf8")).toBe(
      "from the index-only stack\n",
    );
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
  }),
);

it.effect("show resolves an index-only stack from the cache that new refreshed", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    yield* fixture.list;
    yield* publishIndexOnly(fixture);
    decoded(yield* fixture.run(jsonArgs));

    const result = yield* fixture.run(["show", indexOnly.id, "--json"]);
    success(result);
    expect(Schema.decodeUnknownSync(ShowReport)(JSON.parse(result.stdout))).toMatchObject({
      id: indexOnly.id,
      origin: "index",
    });
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
  }),
);

it.effect("new refreshes before the first picker prompt and offers the index-only stack", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    yield* fixture.list;
    yield* publishIndexOnly(fixture);
    let requestsAtPrompt: ReadonlyArray<string> = [];
    const script = terminalScript([
      (screen) => {
        requestsAtPrompt = fixture.requests();
        const fromIndex = numberedRows(screen).some(({ text }) => text.startsWith(indexOnly.id));
        return choose(fromIndex ? indexOnly.id : "sample")(screen);
      },
      "",
      "picker-project",
    ]);

    const result = yield* fixture.run(["new", "--sandbox", "--no-launch"], {
      host: pickerTTY,
      terminal: script,
    });
    success(result);
    expect(requestsAtPrompt).toEqual([fixtureIndexPath, fixtureIndexPath]);
    expect(numberedRows(script.screens[0] ?? "").map(({ text }) => text)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^index-only-stack: /)]),
    );
    expect(readFileSync(join(fixture.home, "picker-project", `${indexOnly.id}.txt`), "utf8")).toBe(
      "from the index-only stack\n",
    );
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
  }),
);
