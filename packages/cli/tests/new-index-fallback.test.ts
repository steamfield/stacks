import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { SignedIndex } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { NewResult } from "../src/schemas/new";
import type { IndexFallbackReason } from "../src/schemas/remote-index";
import { VERSION } from "../src/version";
import { terminal } from "./helpers/cli";
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

const newArgs = ["new", "sample", "project", "--sandbox", "--no-launch"];
const jsonArgs = [...newArgs, "--json"];
const bundledSuffix = `; used the registry bundled with stacks ${VERSION}.`;

function decoded(result: CommandResult) {
  success(result);
  return Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout), {
    onExcessProperty: "error",
  });
}

const warnings = (value: NewResult) =>
  value.warnings.filter(({ code }) => code === "index_fallback");

function reportLines(result: CommandResult) {
  success(result);
  return indexFallbackLines(result.stdout);
}

function serveFailure(
  fixture: Effect.Success<typeof indexRefreshFixture>,
  reason: Exclude<typeof IndexFallbackReason.Type, "timeout">,
) {
  writeFixtureIndex(
    fixture.published,
    [fixture.stack],
    reason === "unsupported" ? { minCli: "999.0.0" } : {},
  );
  const path = join(fixture.published, fixtureIndexPath);
  switch (reason) {
    case "network":
    case "not_found":
      fixture.server.mode(reason);
      break;
    case "invalid":
      writeFileSync(path, "{broken");
      break;
    case "signature": {
      const envelope = Schema.decodeUnknownSync(SignedIndex)(
        JSON.parse(readFileSync(path, "utf8")),
      );
      writeFileSync(
        path,
        JSON.stringify({ ...envelope, signature: Buffer.alloc(64).toString("base64") }),
      );
      break;
    }
  }
}

it.effect.each(["network", "not_found", "invalid", "signature", "unsupported"] as const)(
  "new reports %s from the official index and composes the bundled stack",
  (reason) =>
    Effect.gen(function* () {
      const fixture = yield* indexRefreshFixture;
      serveFailure(fixture, reason);

      const result = decoded(yield* fixture.run(jsonArgs));
      expect(readFileSync(join(result.project, "sample.txt"), "utf8")).toBe("bundled sample\n");
      expect(fixture.requests().length).toBeGreaterThan(0);
      expect(warnings(result)).toStrictEqual([{ code: "index_fallback", id: "index", reason }]);
    }),
);

it.effect("new times out and reports the stored cachedAt while composing from the cache", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureEntry(fixture.upstream, fixture.stack, "sample from the cached index\n");
    const cached = yield* Effect.promise(() =>
      writeFixtureBundle(fixture.published, fixture.upstream, fixture.stack),
    );
    writeFixtureIndex(fixture.published, [cached]);
    expect((yield* fixture.list).entries).toMatchObject([
      { id: "sample", origin: "index" },
      {
        id: "tools",
        origin: "bundled",
      },
    ]);
    const { cachedAt } = yield* fixture.status;
    expect(cachedAt).toEqual(expect.any(String));
    yield* TestClock.adjust("42 minutes");
    fixture.server.mode("hold");

    const result = decoded(yield* runThroughIndexTimeout(fixture.run(jsonArgs), fixture.requests));
    expect(warnings(result)).toStrictEqual([
      { code: "index_fallback", id: "index", reason: "timeout", cachedAt },
    ]);
    expect(readFileSync(join(result.project, "sample.txt"), "utf8")).toBe(
      "sample from the cached index\n",
    );
    expect(fixture.requests()).toEqual([fixtureIndexPath, fixtureIndexPath]);
  }),
);

it.effect("new times out without a cache and composes the bundled stack", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    fixture.server.mode("hold");

    const result = decoded(yield* runThroughIndexTimeout(fixture.run(jsonArgs), fixture.requests));
    expect(readFileSync(join(result.project, "sample.txt"), "utf8")).toBe("bundled sample\n");
    expect(warnings(result)).toStrictEqual([
      { code: "index_fallback", id: "index", reason: "timeout" },
    ]);
    expect(fixture.requests()).toEqual([fixtureIndexPath]);
  }),
);

it.effect.each([
  { cache: "with a cache", warm: true },
  { cache: "without a cache", warm: false },
])("new --offline makes no index request and reports offline $cache", ({ warm }) =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    if (warm) yield* fixture.list;
    const { cachedAt } = yield* fixture.status;
    expect(cachedAt).toEqual(warm ? expect.any(String) : null);
    const before = fixture.server.requests.slice();

    const result = decoded(yield* fixture.run([...jsonArgs, "--offline"]));
    expect(fixture.server.requests).toEqual(before);
    expect(warnings(result)).toStrictEqual([
      { code: "index_fallback", id: "index", reason: "offline", ...(warm ? { cachedAt } : {}) },
    ]);
  }),
);

it.effect.each([
  { unit: "minutes", elapsedMs: 42 * 60_000 + 37_000, age: "42(?: ?m| min(?:s|utes)?)" },
  { unit: "hours", elapsedMs: 36 * 3_600_000 + 47 * 60_000, age: "36(?: ?h| hr(?:s)?| hours)" },
  { unit: "days", elapsedMs: 3 * 86_400_000 + 13 * 3_600_000, age: "3(?: ?d| days)" },
])(
  "new prints the same cached timeout in both audiences at an age in $unit",
  ({ elapsedMs, age }) =>
    Effect.gen(function* () {
      const fixture = yield* indexRefreshFixture;
      writeFixtureIndex(fixture.published, [fixture.stack]);
      yield* fixture.list;
      yield* TestClock.adjust(elapsedMs);
      fixture.server.mode("hold");

      const agent = yield* runThroughIndexTimeout(fixture.run(newArgs), fixture.requests);
      const human = yield* runThroughIndexTimeout(
        fixture.run(["new", "sample", "human-project", "--sandbox", "--no-launch"], {
          host: terminal,
        }),
        fixture.requests,
      );
      const agentLines = reportLines(agent);
      const humanLines = reportLines(human);
      const line = new RegExp(
        `^Index unreachable \\(timeout\\); used the cached index from 2026-11-18 10:23 UTC \\(${age} old\\)\\.$`,
      );
      expect(agentLines).toEqual([expect.stringMatching(line)]);
      expect(humanLines).toEqual(agentLines);
    }),
);

it.effect("new prints the bundled timeout fallback on agent stdout", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    writeFixtureIndex(fixture.published, [fixture.stack]);
    fixture.server.mode("hold");

    const result = yield* runThroughIndexTimeout(fixture.run(newArgs), fixture.requests);
    expect(reportLines(result)).toEqual([`Index unreachable (timeout)${bundledSuffix}`]);
  }),
);

it.effect.each([
  { reason: "signature", wording: "Index signature failed" },
  { reason: "unsupported", wording: "Index needs a newer stacks (run stacks update)" },
  { reason: "offline", wording: "Offline" },
] as const)("new prints the bundled $reason fallback on agent stdout", ({ reason, wording }) =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    serveFailure(fixture, reason);
    const args = reason === "offline" ? [...newArgs, "--offline"] : newArgs;

    expect(reportLines(yield* fixture.run(args))).toEqual([`${wording}${bundledSuffix}`]);
  }),
);

it.effect("new with no configured index omits the warning from JSON and the text report", () =>
  Effect.gen(function* () {
    const fixture = yield* indexRefreshFixture;
    expect(warnings(decoded(yield* fixture.unconfigured(jsonArgs)))).toEqual([]);
    const report = yield* fixture.unconfigured([
      "new",
      "sample",
      "other-project",
      "--sandbox",
      "--no-launch",
    ]);
    expect(reportLines(report)).toEqual([]);
    expect(fixture.server.requests).toEqual([]);
  }),
);
