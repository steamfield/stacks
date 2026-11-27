import { cpSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { ListResult } from "../../src/schemas/list";
import { quiet, runCli, tempDir } from "../helpers/cli";
import { minimal, writeEntry } from "../helpers/registry";
import { GoldenSet } from "../helpers/search-golden";
import { bundled } from "./helpers/bundled";

type Query = GoldenSet["queries"][number];
type Ref = Pick<ListResult["entries"][number], "kind" | "id">;

const fixtures = join(import.meta.dirname, "fixtures", "search");
const fixtureRegistry = join(fixtures, "registry");
const pools = ["platform", "product", "paraphrase", "trap", "fragment", "combined", "no-match"];

function readSet(name: string): GoldenSet {
  return Schema.decodeUnknownSync(GoldenSet)(
    JSON.parse(readFileSync(join(fixtures, name), "utf8")),
  );
}

async function entries(root: string): Promise<ReadonlyArray<Ref>> {
  const result = await runCli(["list", "--json"], {
    env: quiet,
    host: { registry: root },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const report = Schema.decodeUnknownSync(ListResult)(JSON.parse(result.stdout));
  expect(report.rejected).toEqual([]);
  expect(report.entries.length).toBeGreaterThan(0);
  return report.entries;
}

// These are the coverage test's diagnostics, exercised with real entries and negative fixtures
// so a renamed id or a new stack produces an actionable failure when the catalog changes.
function referenceProblems(set: GoldenSet, registry: ReadonlyArray<Ref>): string[] {
  const known = new Set(registry.map((entry) => `${entry.kind}:${entry.id}`));
  return set.queries.flatMap((query: Query) => {
    const refs = [...query.relevant, ...(query.first ? [query.first] : [])];
    const missing = new Set(
      refs.map((ref: Ref) => `${ref.kind}:${ref.id}`).filter((key: string) => !known.has(key)),
    );
    return [...missing].map((key) => `${query.id}: unknown ${key}`);
  });
}

function coverageProblems(set: GoldenSet, registry: ReadonlyArray<Ref>): string[] {
  return registry.flatMap((entry) => {
    if (entry.kind === "stack") {
      const count = set.queries.filter(
        (query: Query) => query.first?.kind === "stack" && query.first.id === entry.id,
      ).length;
      return count < 2 ? [`stack:${entry.id}: first for ${count} queries; need at least 2`] : [];
    }
    const covered = set.queries.some((query: Query) =>
      query.relevant.some(
        (ref: Query["relevant"][number]) =>
          ref.kind === "fragment" && ref.id === entry.id && ref.grade >= 1,
      ),
    );
    return covered ? [] : [`fragment:${entry.id}: no relevant query`];
  });
}

test("the golden set decodes, has unique query ids and grade-2 first judgments [4.5a#1]", () => {
  const set = readSet("golden.json");
  expect(set.schemaVersion).toBe(1);
  expect(set.queries.length).toBeGreaterThan(0);
  const ids = set.queries.map((query: Query) => query.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const query of set.queries) {
    if (query.first) {
      expect(query.relevant, query.id).toContainEqual({ ...query.first, grade: 2 });
    }
  }
});

test("every golden reference names a bundled entry of its kind [4.5a#2]", async () => {
  expect(referenceProblems(readSet("golden.json"), await entries(bundled))).toEqual([]);
});

test("an unknown id names its query in the coverage failure [4.5a#2]", async () => {
  const registry = await entries(fixtureRegistry);
  expect(referenceProblems(readSet("coverage.json"), registry)).toEqual([]);
  expect(referenceProblems(readSet("unknown-id.json"), registry)).toEqual([
    "unknown-stack-request: unknown stack:no-such-stack",
  ]);
});

test("a reference cannot borrow an existing id from the other kind [4.5a#2]", async () => {
  const set = readSet("coverage.json");
  const wrongKind = {
    ...set,
    queries: set.queries.map(
      (query: Query): Query => ({
        ...query,
        relevant: [...query.relevant, { kind: "stack", id: "logging", grade: 1 }],
      }),
    ),
  } satisfies GoldenSet;
  expect(referenceProblems(wrongKind, await entries(fixtureRegistry))).toEqual([
    "sample-tune: unknown stack:logging",
    "sample-holdout: unknown stack:logging",
  ]);
});

test("every bundled stack has two first queries and every fragment is relevant [4.5a#3]", async () => {
  expect(coverageProblems(readSet("golden.json"), await entries(bundled))).toEqual([]);
});

test("adding an uncovered stack names it without false positives [4.5a#3]", async () => {
  const dir = tempDir();
  try {
    const root = join(realpathSync(dir.path), "registry");
    cpSync(fixtureRegistry, root, { recursive: true });
    const set = readSet("coverage.json");
    expect(coverageProblems(set, await entries(root))).toEqual([]);
    writeEntry({
      root,
      kind: "stack",
      dir: "extra-stack",
      frontmatter: minimal("stack", "extra-stack"),
    });
    expect(coverageProblems(set, await entries(root))).toEqual([
      "stack:extra-stack: first for 0 queries; need at least 2",
    ]);
  } finally {
    dir.cleanup();
  }
});

test("one first query is insufficient and a fragment needs a relevant query [4.5a#3]", async () => {
  const set = readSet("coverage.json");
  const reduced = {
    ...set,
    queries: set.queries.slice(0, 1).map((query: Query) => ({
      ...query,
      relevant: query.relevant.filter((ref: Ref) => ref.kind === "stack"),
    })),
  };
  expect(coverageProblems(reduced, await entries(fixtureRegistry))).toEqual([
    "stack:sample: first for 1 queries; need at least 2",
    "fragment:logging: no relevant query",
  ]);
});

test("holdout is about a third with at least twelve queries and both splits in every pool [4.5a#4]", () => {
  const { queries } = readSet("golden.json");
  const holdout = queries.filter((query: Query) => query.split === "holdout");
  expect(holdout.length).toBeGreaterThanOrEqual(12);
  expect(holdout.length / queries.length).toBeGreaterThanOrEqual(0.25);
  expect(holdout.length / queries.length).toBeLessThanOrEqual(0.4);
  for (const pool of pools) {
    const splits = queries
      .filter((query: Query) => query.pool === pool)
      .map((query: Query) => query.split);
    expect(splits, pool).toEqual(expect.arrayContaining(["tune", "holdout"]));
  }
});

test("health, native SwiftUI and no-match controls keep their agreed judgments [4.5a#5]", () => {
  const { queries } = readSet("golden.json");
  const health = queries.find((query: Query) => query.query === "an iOS health app");
  expect(health).toBeDefined();
  // A native iOS stack exists, so it answers iOS requests first; Expo stays relevant.
  expect(health?.first).toEqual({ kind: "stack", id: "ios-swiftui" });
  expect(health?.relevant).toContainEqual({ kind: "stack", id: "mobile-expo", grade: 1 });
  expect(["trap", "platform"]).toContain(health?.pool);
  const native = queries.find((query: Query) => query.query === "a native SwiftUI iPhone app");
  expect(native).toBeDefined();
  expect(native?.first).toEqual({ kind: "stack", id: "ios-swiftui" });
  expect(native?.noMatch).not.toBe(true);
  expect(native?.relevant).toContainEqual({ kind: "stack", id: "mobile-expo", grade: 1 });
  expect(queries.filter((query: Query) => query.noMatch === true).length).toBeGreaterThanOrEqual(3);
});
