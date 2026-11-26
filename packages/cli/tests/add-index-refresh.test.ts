import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { AddResult } from "../src/schemas/add";
import { NewResult } from "../src/schemas/new";
import { VERSION } from "../src/version";
import {
  type CommandResult,
  fixtureIndexPath,
  indexFallbackLines,
  indexRefreshFixture,
  runThroughIndexTimeout,
  success,
  writeFixtureBundle,
  writeFixtureEntry,
  writeFixtureIndex,
} from "./helpers/remote-index";

function decoded(result: CommandResult) {
  success(result);
  const value = Schema.decodeUnknownSync(AddResult)(JSON.parse(result.stdout), {
    onExcessProperty: "error",
  });
  return {
    value,
    warnings: value.warnings.filter(({ code }) => code === "index_fallback"),
  };
}

const createProject = Effect.fn("test.createProject")(function* (
  fixture: Effect.Success<typeof indexRefreshFixture>,
  name: string,
) {
  const created = yield* fixture.unconfigured([
    "new",
    "sample",
    name,
    "--sandbox",
    "--no-launch",
    "--json",
  ]);
  success(created);
  return Schema.decodeUnknownSync(NewResult)(JSON.parse(created.stdout)).project;
});

const setup = Effect.gen(function* () {
  const fixture = yield* indexRefreshFixture;
  const project = yield* createProject(fixture, "project");
  return {
    ...fixture,
    project,
    addArgs: (fragment = fixture.fragment.id) => [
      "add",
      fragment,
      "--dir",
      project,
      "--no-launch",
      "--json",
    ],
  };
});

const cachedTools = "tools from the cached index\n";
const etag = '"cached-index"';
const cacheTools = Effect.fn("test.cacheTools")(function* (fixture: Effect.Success<typeof setup>) {
  writeFixtureEntry(fixture.upstream, fixture.fragment, cachedTools);
  const indexed = yield* Effect.promise(() =>
    writeFixtureBundle(fixture.published, fixture.upstream, fixture.fragment),
  );
  writeFixtureIndex(fixture.published, [fixture.stack, indexed]);
  fixture.server.setEtag(etag);
  yield* fixture.list;
});

it.effect("add makes one conditional index request across a 304 and later registry reads", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* cacheTools(fixture);

    const { value, warnings } = decoded(yield* fixture.run(fixture.addArgs()));
    expect(value.added).toEqual(["tools"]);
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
    expect(fixture.headers()[1]?.["if-none-match"]).toBe(etag);
    expect(readFileSync(join(fixture.project, "tools.txt"), "utf8")).toBe(cachedTools);
    expect(warnings).toEqual([]);
  }),
);

it.effect(
  "add times out on a held index and still adds the fragment with the cachedAt warning",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* cacheTools(fixture);
      const { cachedAt } = yield* fixture.status;
      expect(cachedAt).toEqual(expect.any(String));
      fixture.server.mode("hold");

      const { value, warnings } = decoded(
        yield* runThroughIndexTimeout(fixture.run(fixture.addArgs()), fixture.requests),
      );
      expect(value.added).toEqual(["tools"]);
      expect(readFileSync(join(fixture.project, "tools.txt"), "utf8")).toBe(cachedTools);
      expect(warnings).toStrictEqual([
        { code: "index_fallback", id: "index", reason: "timeout", cachedAt },
      ]);
      expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
    }),
);

it.effect("add prints the offline fallback on agent stdout", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    const textArgs = fixture.addArgs().filter((arg) => arg !== "--json");
    const result = yield* fixture.run([...textArgs, "--offline"]);
    success(result);
    expect(fixture.server.requests).toEqual([]);
    expect(indexFallbackLines(result.stdout)).toEqual([
      `Offline; used the registry bundled with stacks ${VERSION}.`,
    ]);
  }),
);

it.effect("add omits the warning from JSON and the text report when no index is configured", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;

    const { value, warnings } = decoded(yield* fixture.unconfigured(fixture.addArgs()));
    expect(value.added).toEqual(["tools"]);
    expect(warnings).toEqual([]);
    const textProject = yield* createProject(fixture, "text-project");
    const report = yield* fixture.unconfigured([
      "add",
      "tools",
      "--dir",
      textProject,
      "--no-launch",
    ]);
    success(report);
    expect(indexFallbackLines(report.stdout)).toEqual([]);
    expect(fixture.server.requests).toEqual([]);
  }),
);

it.effect("add installs an index-only fragment that was missing from the fresh cache", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    writeFixtureIndex(fixture.published, [fixture.stack, fixture.fragment]);
    yield* fixture.list;
    const indexOnly = { kind: "fragment", id: "index-only-fragment" } as const;
    writeFixtureEntry(fixture.upstream, indexOnly, "from the index-only fragment\n");
    const entry = yield* Effect.promise(() =>
      writeFixtureBundle(fixture.published, fixture.upstream, indexOnly),
    );
    writeFixtureIndex(fixture.published, [fixture.stack, fixture.fragment, entry], {
      commit: "2".repeat(40),
    });

    const { value, warnings } = decoded(yield* fixture.run(fixture.addArgs(indexOnly.id)));
    expect(value.added).toEqual([indexOnly.id]);
    expect(readFileSync(join(fixture.project, `${indexOnly.id}.txt`), "utf8")).toBe(
      "from the index-only fragment\n",
    );
    expect(warnings).toEqual([]);
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
  }),
);
