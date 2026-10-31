import {
  Columnar,
  rank,
  SearchHit,
  SearchMetadata,
  SearchVocabulary,
} from "@steamfield/stacks-format";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { searchInput } from "./helpers/search-input";

function input() {
  const raw = searchInput();
  return {
    ...raw,
    vocabulary: Schema.decodeUnknownSync(SearchVocabulary)({
      ...raw.vocabulary,
      platforms: { ...raw.vocabulary.platforms, ios: ["iPhone"] },
      productKinds: { "web-app": ["saas"], "cli-tool": ["command line tool"] },
    }),
    entries: raw.entries.map((record) => ({
      ...record,
      search: Schema.decodeUnknownSync(SearchMetadata)(record.search),
    })),
  };
}

test("facet penalties name the request phrase and conflicting entry values", () => {
  // One facet per request: rank drops a hit whose penalties round its score to zero, and
  // "command" (description, summary and body) keeps typescript-cli's score above it.
  for (const [request, penalty] of [
    ["iPhone command", { kind: "platform", request: "iPhone (ios)", entry: "cli" }],
    ["command in Go", { kind: "language", request: "Go (go)", entry: "typescript" }],
    ["saas command", { kind: "productKind", request: "saas (web-app)", entry: "cli-tool" }],
  ] as const) {
    const hit = rank({ ...input(), request }).stacks.find(({ id }) => id === "typescript-cli");
    expect(hit?.penalties, request).toEqual([penalty]);
    expect(hit?.tier, request).not.toBe("strong");
  }
});

test("one matching product kind suffices and absent facets or cards stay unknown", () => {
  const base = input();
  const record = base.entries[0];
  if (record?.search.kind !== "stack") throw new Error("Missing stack fixture");
  for (const search of [record.search, { ...record.search, productKinds: [] }, undefined]) {
    const entries = [{ entry: record.entry, ...(search ? { search } : {}) }];
    for (const request of ["saas command line tool", "go cli"]) {
      const result = rank({ ...base, entries, request });
      expect(result.stacks[0]?.penalties).toEqual([]);
    }
  }
});

test("a product mismatch multiplies squashed relevance by 0.3 once for the whole category", () => {
  const base = input();
  const record = base.entries[0];
  if (record?.search.kind !== "stack") throw new Error("Missing stack fixture");
  const search = record.search;
  const run = (productKinds: string[]) =>
    rank({
      ...base,
      request: "go saas",
      entries: [{ ...record, search: { ...search, productKinds } }],
    }).stacks[0];
  const unknown = run([]);
  const mismatched = run(["cli-tool", "mobile-app"]);
  if (!unknown || !mismatched) throw new Error("Missing ranked fixture");
  expect(unknown.penalties).toEqual([]);
  expect(mismatched.penalties).toEqual([
    { kind: "productKind", request: "saas (web-app)", entry: "cli-tool, mobile-app" },
  ]);
  expect(mismatched.score).toBeCloseTo(0.3 * unknown.score, 2);
});

test.each([
  ["a terminal user interface", "a terminal user interface"],
  ["interface for a terminal user", "interface terminal user"],
  ["a good TUI experience", "TUI"],
])("notFor names the matched exclusion and request words for %s", (request, matched) => {
  const base = input();
  const entries = base.entries.map((record) => ({
    ...record,
    search: { ...record.search, notFor: ["graphical interfaces", "a terminal user interface"] },
  }));
  const result = rank({ ...base, entries, request });
  for (const hit of result.stacks)
    expect(hit.penalties).toEqual([
      { kind: "notFor", request: matched, entry: "a terminal user interface" },
    ]);
});

test("untrusted penalties name only the entry origin", () => {
  const base = input();
  const entries = base.entries.map((record) => ({
    ...record,
    entry: { ...record.entry, trusted: false, origin: "project" as const },
  }));
  const result = rank({ ...base, entries });
  expect(result.stacks[0]?.penalties).toEqual([
    { kind: "untrusted", request: "", entry: "project" },
  ]);
  expect(result.stacks[0]?.tier).not.toBe("strong");
});

test("empty platform and language lists still explain their existing mismatch penalties", () => {
  const base = input();
  const entries = base.entries.map((record) => ({
    ...record,
    search: { ...record.search, platforms: [], languages: [] },
  }));
  expect(rank({ ...base, entries }).stacks[0]?.penalties).toEqual([
    { kind: "platform", request: "cli", entry: "(none listed)" },
    { kind: "language", request: "go", entry: "(none listed)" },
  ]);
});

test("structured penalties stay in one column and roundtrip beside empty penalties", () => {
  const base = input();
  const penalized = rank({ ...base, request: "iPhone saas in Go" }).stacks;
  const plain = rank(base).stacks.filter(({ penalties }) => penalties.length === 0);
  const other = rank({
    ...base,
    request: "a good TUI experience",
    entries: base.entries.map((record) => ({
      ...record,
      entry: { ...record.entry, trusted: false },
      search: { ...record.search, notFor: ["a terminal user interface"] },
    })),
  }).stacks;
  const rows = [...penalized, ...plain, ...other].map(({ why, penalties }) => ({ why, penalties }));
  const schema = Columnar(
    Schema.Struct({ why: SearchHit.fields.why, penalties: SearchHit.fields.penalties }),
  );
  const encoded = Schema.encodeSync(schema)(rows);
  expect(encoded.penalties).toEqual(rows.map(({ penalties }) => penalties));
  expect(Object.keys(encoded).filter((key) => key.startsWith("penalties"))).toEqual(["penalties"]);
  expect(Schema.decodeUnknownSync(schema)(encoded)).toEqual(rows);
});
