import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import type { IndexEntry } from "@steamfield/stacks-format";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { INDEX_REFRESH_DEADLINE_MS } from "../src/constants";
import { NewResult } from "../src/schemas/new";
import { ProjectSources } from "../src/schemas/sources";
import { bundleFile } from "./fixtures/index/harness";
import { type HeldServer, heldServer } from "./helpers/held-server";
import { pickerTTY } from "./helpers/picker";
import {
  fixtureIndexPath,
  indexCommandFixture,
  indexRefreshFixture,
  success,
  writeFixtureBundle,
  writeFixtureEntry,
  writeFixtureIndex,
} from "./helpers/remote-index";
import { choose, terminalScript } from "./helpers/scripted-terminal";

function sources(project: string) {
  return Schema.decodeUnknownSync(ProjectSources)(
    JSON.parse(readFileSync(join(project, ".stacks/sources.json"), "utf8")),
    { onExcessProperty: "error" },
  );
}

it.effect.each([200, 304])(
  "new records the index header after a %i even when every entry comes from bundled files",
  (status) =>
    Effect.gen(function* () {
      const fixture = yield* indexRefreshFixture;
      const cached = writeFixtureIndex(fixture.published, [fixture.stack]);
      fixture.server.setEtag('"cached-index"');
      yield* fixture.list;
      const index =
        status === 304
          ? cached
          : writeFixtureIndex(fixture.published, [fixture.stack], {
              commit: "2".repeat(40),
              generatedAt: "2026-11-18T09:15:00Z",
            });
      if (status === 200) fixture.server.setEtag('"new-index"');

      const result = yield* fixture.run([
        "new",
        "sample",
        "project",
        "--sandbox",
        "--no-launch",
        "--json",
      ]);
      success(result);
      const { project } = Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout), {
        onExcessProperty: "error",
      });
      const written = sources(project);
      expect(written.index).toMatchObject({
        commit: index.commit,
        generatedAt: index.generatedAt,
      });
      expect(written.entries).toEqual([
        { kind: "stack", id: "sample", origin: "bundled", digest: fixture.stack.digest },
      ]);
      expect([...fixture.server.requests].sort()).toEqual([
        "/v1/allowlist.json",
        fixtureIndexPath,
        fixtureIndexPath,
      ]);
      expect(fixture.headers()[1]?.["if-none-match"]).toBe('"cached-index"');
    }),
);

const stageMs = 1_100;
const slots = 8;
const bundlePath = (entry: IndexEntry) => `/${bundleFile("", entry)}`;

const withHeldBundles = Effect.fn("test.withHeldBundles")(function* () {
  const fixture = yield* indexCommandFixture;
  const entries: IndexEntry[] = [];
  for (let n = 0; n < 2 * slots + 1; n++) {
    const ref = { kind: "stack", id: `delayed-${n}` } as const;
    writeFixtureEntry(fixture.bundled, ref, "bundled stack\n");
    writeFixtureEntry(fixture.upstream, ref, "stack from the late index bundle\n");
    entries.push(
      yield* Effect.promise(() => writeFixtureBundle(fixture.published, fixture.upstream, ref)),
    );
  }
  writeFixtureIndex(fixture.published, entries);
  const server = yield* Effect.acquireRelease(
    Effect.promise(() => heldServer(fixture.published, (path) => path.startsWith("/v1/entries/"))),
    (server) => Effect.promise(() => server.close()),
  );
  return { ...fixture, server, entries };
});

const pendingCount = (server: HeldServer, count: number) =>
  Effect.promise(() => expect.poll(() => server.pending()).toHaveLength(count));

it.effect("new composes and records the index stack when the picker ran out of time waiting", () =>
  Effect.gen(function* () {
    const { home, server, entries, connect } = yield* withHeldBundles();
    let selected: IndexEntry | undefined;
    const script = terminalScript([
      (screen) => {
        if (!selected) throw new Error("The picker appeared before the final bundle wave");
        // The row was listed even though its index bundle is still held.
        expect(server.pending()).toEqual([bundlePath(selected)]);
        server.release();
        return choose(`${selected.id}:`)(screen);
      },
      "",
      "project",
    ]);
    const running = yield* connect(server)(["new", "--sandbox", "--no-launch"], {
      host: pickerTTY,
      terminal: script,
    }).pipe(Effect.forkChild);

    // Time moves only after a full wave arrives. The final request starts late enough to
    // outlast the shared catalog deadline while staying within its own transport deadline.
    for (let wave = 0; wave < 2; wave++) {
      yield* pendingCount(server, slots);
      yield* TestClock.adjust(stageMs);
      server.release();
    }
    yield* pendingCount(server, 1);
    const [last] = server.pending();
    selected = entries.find((entry) => bundlePath(entry) === last);
    if (!selected) throw new Error(`No fixture entry for held path ${last}`);
    expect(script.reads).toBe(0);
    yield* TestClock.adjust(INDEX_REFRESH_DEADLINE_MS - 2 * stageMs + 1);

    success(yield* Fiber.join(running));
    const { id, digest } = selected;
    const project = join(home, "project");
    expect(readFileSync(join(project, `${id}.txt`), "utf8")).toBe(
      "stack from the late index bundle\n",
    );
    expect(sources(project).entries.find((row) => row.kind === "stack" && row.id === id)).toEqual({
      kind: "stack",
      id,
      origin: "index",
      digest,
    });
  }),
);
