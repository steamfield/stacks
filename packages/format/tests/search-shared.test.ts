import {
  compareSearchHits,
  FragmentMeta,
  type Kind,
  type RankInput,
  type RankRecord,
  rank,
  SearchHit,
  SearchIndex,
  SearchMetadata,
  SearchResponse,
  SearchResult,
  SearchVocabulary,
  StackMeta,
} from "@steamfield/stacks-format";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { searchInput } from "./helpers/search-input";

const selectionRequest = "quasar nebula pulsar";
function selectionRecord(kind: Kind, id: string, metadataMatch = false): RankRecord {
  const fields = {
    schema_version: 1,
    kind,
    id,
    name: metadataMatch ? selectionRequest : "A starter",
    description: metadataMatch ? selectionRequest : "General purpose tooling.",
    tags: metadataMatch ? selectionRequest.split(" ") : [],
    category: "tooling",
  };
  return {
    entry: {
      id,
      kind,
      origin: "bundled",
      trusted: true,
      meta:
        kind === "stack"
          ? Schema.decodeUnknownSync(StackMeta)(fields)
          : Schema.decodeUnknownSync(FragmentMeta)(fields),
      body: selectionRequest,
    },
  };
}
function selectionInput(): RankInput {
  return {
    request: selectionRequest,
    vocabulary: Schema.decodeUnknownSync(SearchVocabulary)({
      schemaVersion: 1,
      platforms: {},
      productKinds: {},
      languages: {},
      capabilities: {},
    }),
    entries: (["stack", "fragment"] as const).flatMap((kind) => [
      selectionRecord(kind, "quasar-nebula-pulsar", true),
      ...Array.from({ length: 8 }, (_, index) => selectionRecord(kind, `body-match-${index}`)),
    ]),
  };
}

test.each(["!!!", "unfindable"])(
  "a request with no matches (%s) returns empty lists",
  (request) => {
    const result = rank({ ...selectionInput(), request });
    expect(result).toMatchObject({ stacks: [], fragments: [], noStrongMatch: true });
  },
);

test.each([true, false])(
  "strong or partial matches cap weak padding per list (trusted %s)",
  (trusted) => {
    const input = selectionInput();
    const result = rank({
      ...input,
      entries: input.entries.map((record) =>
        record.entry.id === "quasar-nebula-pulsar"
          ? { ...record, entry: { ...record.entry, trusted } }
          : record,
      ),
    });
    for (const list of [result.stacks, result.fragments]) {
      expect(list.map(({ id }) => id)).toEqual([
        "quasar-nebula-pulsar",
        "body-match-0",
        "body-match-1",
      ]);
      expect(list[0]?.tier).toBe(trusted ? "strong" : "partial");
      expect(list.slice(1).map(({ tier }) => tier)).toEqual(["weak", "weak"]);
    }
    expect(result.noStrongMatch).toBe(!trusted);
  },
);

test.each([1, 3, 5, 20])("weak-only lists keep positive candidates up to limit %s", (limit) => {
  const input = selectionInput();
  const result = rank({
    ...input,
    limit,
    entries: input.entries.filter(({ entry }) => entry.id !== "quasar-nebula-pulsar"),
  });
  expect(result.noStrongMatch).toBe(true);
  for (const list of [result.stacks, result.fragments]) {
    expect(list).toHaveLength(Math.min(limit, 8));
    for (const hit of list) {
      expect(hit.tier).toBe("weak");
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.why.length).toBeGreaterThan(0);
    }
  }
});

test.each(["stack", "fragment"] as const)(
  "a %s match does not cap the other weak-only list",
  (kind) => {
    const input = selectionInput();
    const result = rank({
      ...input,
      entries: input.entries.filter(
        ({ entry }) => entry.kind === kind || entry.id !== "quasar-nebula-pulsar",
      ),
    });
    expect(result.stacks).toHaveLength(kind === "stack" ? 3 : 5);
    expect(result.fragments).toHaveLength(kind === "fragment" ? 3 : 5);
  },
);

test.each(["stack", "fragment"] as const)(
  "%s filtering preserves per-list limits and stack noStrongMatch",
  (kind) => {
    const result = rank({ ...selectionInput(), kind, limit: 1 });
    expect(result.stacks).toHaveLength(kind === "stack" ? 1 : 0);
    expect(result.fragments).toHaveLength(kind === "fragment" ? 1 : 0);
    expect(result.noStrongMatch).toBe(false);
  },
);

test("returned hits explain a positive match and round scores and coverage to three decimals", () => {
  const raw = searchInput();
  const input = {
    ...raw,
    request: "go cli tool unknown",
    vocabulary: Schema.decodeUnknownSync(SearchVocabulary)(raw.vocabulary),
    entries: raw.entries.map((record) => ({
      ...record,
      search: Schema.decodeUnknownSync(SearchMetadata)(record.search),
    })),
  };
  const result = rank(input);
  expect(result.stacks.length).toBeGreaterThan(0);
  for (const hit of [...result.stacks, ...result.fragments]) {
    expect(hit.score).toBeGreaterThan(0);
    expect(hit.why.length).toBeGreaterThan(0);
    for (const value of [hit.score, hit.coverage]) expect(value).toBe(Number(value.toFixed(3)));
  }
});

test("scores that round to zero are omitted", () => {
  const input = selectionInput();
  const result = rank({
    ...input,
    request: "quasar",
    entries: input.entries.filter(({ entry }) => entry.id !== "quasar-nebula-pulsar"),
  });
  expect(result.stacks.length).toBeGreaterThan(0);
  expect(result.fragments).toEqual([]);
});

test("rounding does not replace score ordering with an id tie-break", () => {
  const input = selectionInput();
  const record = selectionRecord("stack", "z-higher-score", true);
  const body = `${selectionRequest} ${"filler ".repeat(1000)}`;
  const result = rank({
    ...input,
    entries: [
      { ...record, entry: { ...record.entry, id: "a-lower-score", body: `${body} filler` } },
      { ...record, entry: { ...record.entry, body } },
    ],
  });
  expect(result.stacks.map(({ id }) => id)).toEqual(["z-higher-score", "a-lower-score"]);
  expect(result.stacks[0]?.score).toBe(result.stacks[1]?.score);
});

test("the public search schemas and pure ranker retain lexical language and TUI behaviour [4.5e#13]", () => {
  const raw = searchInput();
  const input = {
    ...raw,
    vocabulary: Schema.decodeUnknownSync(SearchVocabulary)(raw.vocabulary),
    entries: raw.entries.map((record) => ({
      ...record,
      search: Schema.decodeUnknownSync(SearchMetadata)(record.search),
    })),
  };
  const before = JSON.stringify(input);
  const go = rank(input);
  expect(Schema.decodeUnknownSync(SearchResult)(go)).toEqual(go);
  expect(go).toMatchObject({
    ranking: "local",
    understood: { languages: ["go"], platforms: ["cli"] },
    noStrongMatch: false,
  });
  expect(go.stacks[0]).toMatchObject({ id: "go-cli", tier: "strong" });
  expect(go.stacks[1]).toMatchObject({
    id: "typescript-cli",
    penalties: [{ kind: "language", request: "go", entry: "typescript" }],
  });
  for (const row of go.stacks) expect(Schema.decodeUnknownSync(SearchHit)(row)).toEqual(row);
  const tui = rank({ ...input, request: "a cli with a good TUI experience" });
  expect(tui.noStrongMatch).toBe(true);
  expect(tui.understood.unmatched).toContain("TUI");
  expect(tui.stacks).toHaveLength(2);
  for (const row of tui.stacks) {
    expect(row.tier).not.toBe("strong");
    expect(row.penalties).toContainEqual({
      kind: "notFor",
      request: "tui experience",
      entry: "a TUI experience",
    });
  }
  expect(JSON.stringify(input)).toBe(before);
  expect(rank(input)).toEqual(go);
});

test("the public signed search schema roundtrips vocabulary and rejects its absence [4.5e#13]", () => {
  const raw = searchInput();
  const document = {
    formatVersion: 1,
    entries: raw.entries.map((record) => record.search),
    vocabulary: raw.vocabulary,
  };
  const decoded = Schema.decodeUnknownSync(SearchIndex)(document);
  expect(Schema.decodeUnknownSync(SearchIndex)(Schema.encodeSync(SearchIndex)(decoded))).toEqual(
    decoded,
  );
  const { vocabulary: _vocabulary, ...withoutVocabulary } = document;
  expect(() => Schema.decodeUnknownSync(SearchIndex)(withoutVocabulary)).toThrow();
});

test("the shared HTTP schema accepts the route response without request text [4.5e#13]", () => {
  const raw = searchInput();
  const ranked = rank({
    ...raw,
    vocabulary: Schema.decodeUnknownSync(SearchVocabulary)(raw.vocabulary),
    entries: raw.entries.map((record) => ({
      ...record,
      search: Schema.decodeUnknownSync(SearchMetadata)(record.search),
    })),
  });
  const body = {
    method: "lexical",
    indexGeneratedAt: "2026-10-28T10:00:00Z",
    understood: ranked.understood,
    noStrongMatch: ranked.noStrongMatch,
    stacks: ranked.stacks.map((hit: typeof SearchHit.Type) => ({
      ...hit,
      origin: "index",
      trusted: true,
      evidence: { ...hit.evidence, lastRun: null },
    })),
    fragments: [],
  };
  const wire = Schema.encodeUnknownSync(SearchResponse)(body);
  expect(Schema.decodeUnknownSync(SearchResponse)(wire)).toEqual(body);
  expect(() => Schema.decodeUnknownSync(SearchResponse)({ ...wire, stacks: "invalid" })).toThrow();
  expect(() => Schema.decodeUnknownSync(SearchResponse)({ ...wire, method: "unknown" })).toThrow();
});

const columns = [
  "kind",
  "id",
  "name",
  "summary",
  "origin",
  "trusted",
  "tier",
  "score",
  "coverage",
  "why",
  "penalties",
  "caveats",
  "appliesTo",
  "evidence.stats.greenRateLower",
  "evidence.stats.sample",
  "evidence.stats.projects",
  "evidence.stats.window",
  "evidence.lastRun.date",
  "evidence.lastRun.result",
  "evidence.lastRun.agent",
  "evidence.lastRun.preset",
  "evidence.lastRun.fingerprint",
];

test("API hits encode to complete flattened columns and decode to rows", () => {
  const hit = {
    kind: "stack",
    id: "go-cli",
    name: "Go CLI",
    summary: "A CLI stack",
    origin: "index",
    trusted: true,
    tier: "strong",
    score: 0.84,
    coverage: 1,
    why: [{ field: "platforms", matched: "cli", from: "cli" }],
    penalties: [{ kind: "language", request: "go", entry: "typescript" }],
    evidence: { lastRun: null },
  };
  const run = {
    date: "2026-10-28",
    result: "pass",
    agent: "codex",
    preset: "default",
    fingerprint: "sha256:sample",
  };
  const body = {
    method: "lexical",
    indexGeneratedAt: "2026-10-28T10:00:00Z",
    understood: {
      platforms: ["cli"],
      productKinds: [],
      languages: [],
      capabilities: [],
      unmatched: [],
    },
    noStrongMatch: false,
    stacks: [
      hit,
      {
        ...hit,
        id: "typescript-cli",
        evidence: {
          stats: { greenRateLower: 0.8, sample: 10, projects: 8, window: 28 },
          lastRun: run,
        },
      },
    ],
    fragments: [{ ...hit, kind: "fragment", id: "lint" }],
  };
  const wire = Schema.encodeUnknownSync(SearchResponse)(body);
  expect(Object.keys(wire.stacks)).toEqual(columns);
  expect(Object.keys(wire.fragments)).toEqual(columns);
  expect(Object.values(wire.stacks).every((column) => column.length === 2)).toBe(true);
  expect(Object.values(wire.fragments).every((column) => column.length === 1)).toBe(true);
  expect(wire.stacks.id).toEqual(["go-cli", "typescript-cli"]);
  expect(wire.stacks.score).toEqual([0.84, 0.84]);
  expect(wire.stacks.why).toEqual([hit.why, hit.why]);
  expect(wire.stacks.penalties).toEqual([hit.penalties, hit.penalties]);
  expect(wire.stacks["evidence.lastRun.date"]).toEqual([null, run.date]);
  expect(wire.stacks["evidence.stats.sample"]).toEqual([null, 10]);
  expect(Schema.decodeUnknownSync(SearchResponse)(wire)).toEqual(body);
});

test("empty API hit lists encode every column and decode to empty rows", () => {
  const body = {
    method: "lexical",
    indexGeneratedAt: "2026-10-28T10:00:00Z",
    understood: { platforms: [], productKinds: [], languages: [], capabilities: [], unmatched: [] },
    noStrongMatch: true,
    stacks: [],
    fragments: [],
  };
  const wire = Schema.encodeUnknownSync(SearchResponse)(body);
  for (const list of [wire.stacks, wire.fragments]) {
    expect(Object.keys(list)).toEqual(columns);
    expect(Object.values(list).every((column) => column.length === 0)).toBe(true);
  }
  expect(Schema.decodeUnknownSync(SearchResponse)(wire)).toEqual(body);
});

test("API hit rows require evidence.lastRun even when no run exists", () => {
  const body = {
    method: "lexical",
    indexGeneratedAt: "2026-10-28T10:00:00Z",
    understood: { platforms: [], productKinds: [], languages: [], capabilities: [], unmatched: [] },
    noStrongMatch: false,
    stacks: [
      {
        kind: "stack",
        id: "go-cli",
        name: "Go CLI",
        summary: "A CLI stack",
        origin: "index",
        trusted: true,
        tier: "strong",
        score: 0.84,
        coverage: 1,
        why: [],
        penalties: [],
        evidence: {},
      },
    ],
    fragments: [],
  };
  expect(() => Schema.encodeUnknownSync(SearchResponse)(body)).toThrow();
});

test("confident quality breaks lexical ties, stays transitive, and can lower a poor hit", () => {
  const input = selectionInput();
  const records = ["a", "b", "c"].map((id) => selectionRecord("stack", id, true));
  const ranked = rank({ ...input, entries: records });
  expect(ranked.stacks.map((hit) => hit.id)).toEqual(["a", "b", "c"]);
  const withStats = rank({
    ...input,
    entries: records.map((record) => {
      let evidence = {};
      if (record.entry.id === "b")
        evidence = { stats: { greenRateLower: 0.9, sample: 200, projects: 100, window: 28 } };
      else if (record.entry.id === "a")
        evidence = { stats: { greenRateLower: 0.1, sample: 3, projects: 0, window: 28 } };
      return { ...record, evidence };
    }),
  });
  expect(withStats.stacks.map((hit) => hit.id)).toEqual(["b", "c", "a"]);
  const description = (id: string) => {
    if (id === "b") return selectionRequest;
    if (id === "c") return "quasar nebula";
    return "quasar";
  };
  const varied = rank({
    ...input,
    entries: records.map((record) => ({
      ...record,
      evidence: withStats.stacks.find((hit) => hit.id === record.entry.id)?.evidence ?? {},
      entry: {
        ...record.entry,
        meta: {
          ...record.entry.meta,
          description: description(record.entry.id),
        },
      },
    })),
  });
  const high = varied.stacks.find((hit) => hit.id === "b");
  const middle = varied.stacks.find((hit) => hit.id === "c");
  const low = varied.stacks.find((hit) => hit.id === "a");
  if (!high || !middle || !low) throw new Error("Missing varied quality fixtures");
  expect(new Set([high.score, middle.score, low.score]).size).toBe(3);
  expect(compareSearchHits(high, middle)).toBeLessThan(0);
  expect(compareSearchHits(middle, low)).toBeLessThan(0);
  expect(compareSearchHits(high, low)).toBeLessThan(0);
  const poor = rank({
    ...input,
    entries: records.map((record) => ({
      ...record,
      evidence:
        record.entry.id === "a"
          ? { stats: { greenRateLower: 0.05, sample: 500, projects: 0, window: 28 } }
          : {},
    })),
  });
  expect(poor.stacks.findIndex((hit) => hit.id === "a")).toBeGreaterThan(
    poor.stacks.findIndex((hit) => hit.id === "c"),
  );
});

test("a constraint alone never makes a search hit", () => {
  const input = selectionInput();
  const result = rank({ ...input, request: "add authentication" });
  expect(result.stacks).toEqual([]);
});
