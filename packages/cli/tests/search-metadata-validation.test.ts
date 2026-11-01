import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ListResult } from "../src/schemas/list";
import { quiet, runCli } from "./helpers/cli";
import {
  bundled,
  card,
  cardPath,
  put,
  readJson,
  searchFindings,
  seed,
  stamp,
  validateSearch,
} from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const sample = { kind: "stack", id: "sample" } as const;
function setup() {
  const home = space.dir();
  const root = join(home, "registry café");
  seed(root, sample);
  return { home, root };
}
function rows(report: Awaited<ReturnType<typeof validateSearch>>) {
  return searchFindings(report).map(({ check, severity, kind, entry }) => ({
    check,
    severity,
    kind,
    entry,
  }));
}

test("every bundled entry has a current reviewed card and no warnings [4.5b#1]", async () => {
  const home = space.dir();
  const report = await validateSearch(bundled, { home, bundled: true });
  expect(report.entries.stacks).toBeGreaterThan(0);
  expect(report.entries.fragments).toBeGreaterThan(0);
  expect(report.findings.filter(({ severity }) => severity !== "note")).toEqual([]);
  const listing = await runCli(["list", "--json"], {
    home,
    host: { registry: bundled },
    env: quiet,
  });
  expect(listing.status, listing.stderr).toBe(0);
  expect(listing.stderr).toBe("");
  const entries = Schema.decodeUnknownSync(ListResult)(JSON.parse(listing.stdout)).entries;
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  for (const entry of entries) {
    const value = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(bundled, entry)));
    expect(value.source.reviewedAt, `${entry.kind}/${entry.id}`).not.toBeNull();
    expect(value.kind).toBe(entry.kind);
    expect(value.id).toBe(entry.id);
  }
  // This validates the whole bundled registry; concurrent gates can exceed Vitest's 5 s.
}, 30_000);

test("unknown values, mismatched paths and orphan cards are actionable errors [4.5b#4]", async () => {
  const f = setup();
  put(cardPath(f.root, sample), JSON.stringify({ ...card(sample), platforms: ["ios", "watchos"] }));
  seed(f.root, { kind: "stack", id: "x" });
  put(
    cardPath(f.root, { kind: "stack", id: "x" }),
    JSON.stringify(card({ kind: "stack", id: "y" })),
  );
  put(
    cardPath(f.root, { kind: "fragment", id: "missing" }),
    JSON.stringify(card({ kind: "fragment", id: "missing" })),
  );
  const report = await validateSearch(f.root, f);
  expect(rows(report)).toEqual([
    { check: "search-invalid", severity: "error", kind: "stack", entry: "sample" },
    { check: "search-invalid", severity: "error", kind: "stack", entry: "x" },
    { check: "search-orphan", severity: "error", kind: "fragment", entry: "missing" },
  ]);
  expect(searchFindings(report).find(({ entry }) => entry === "sample")?.message).toContain(
    "watchos",
  );
  expect(searchFindings(report).find(({ entry }) => entry === "x")?.message).toMatch(
    /\bx\b.*\by\b|\by\b.*\bx\b/,
  );
});

test("missing personal cards are notes and validation succeeds [4.5b#5]", async () => {
  const f = setup();
  expect(rows(await validateSearch(f.root, f))).toEqual([
    { check: "search-missing", severity: "note", kind: "stack", entry: "sample" },
  ]);
});

test.each([
  { category: "platforms", values: { mobile: ["phone"], ios: ["phone"] }, tag: "[4.5b#6]" },
  {
    category: "languages",
    values: { typescript: ["shared"], python: ["shared"] },
    tag: "[4.5b#13e]",
  },
])(
  "duplicate aliases within $category are vocabulary-invalid $tag",
  async ({ category, values }) => {
    const f = setup();
    const vocabulary = readJson(join(bundled, "search/vocabulary.json"));
    const { SearchVocabulary } = await import("@steamfield/stacks-format");
    const decoded = Schema.decodeUnknownSync(SearchVocabulary)(vocabulary);
    put(join(f.root, "search/vocabulary.json"), JSON.stringify({ ...decoded, [category]: values }));
    const findings = searchFindings(await validateSearch(f.root, { ...f, bundled: true }));
    expect(findings.filter(({ check }) => check === "vocabulary-invalid")).toHaveLength(1);
    expect(findings.find(({ check }) => check === "vocabulary-invalid")?.severity).toBe("error");
  },
);

test("cross-category aliases are allowed and bare go is absent [4.5b#13e]", async () => {
  const { SearchVocabulary } = await import("@steamfield/stacks-format");
  const vocabulary = Schema.decodeUnknownSync(SearchVocabulary)(
    readJson(join(bundled, "search/vocabulary.json")),
  );
  expect(vocabulary.productKinds["ai-app"]).toContain("llm");
  expect(vocabulary.capabilities.ai).toContain("llm");
  expect(vocabulary.languages.go).not.toContain("go");
  expect(vocabulary.languages.go?.length).toBeGreaterThan(0);
  const f = setup();
  await stamp(f.root, sample);
  put(join(f.root, "search/vocabulary.json"), JSON.stringify(vocabulary));
  expect(searchFindings(await validateSearch(f.root, { ...f, bundled: true }))).toEqual([]);
});

// Validates against the whole bundled registry; the 5 s default is too tight on a loaded gate host.
test("180 text words warn without treating long text as invalid [4.5b#7]", {
  timeout: 15_000,
}, async () => {
  const f = setup();
  const value = await stamp(f.root, sample);
  put(
    cardPath(f.root, sample),
    JSON.stringify({
      ...value,
      summary: Array.from({ length: 25 }, (_, n) => `summary${n}`).join(" "),
      requests: Array.from({ length: 5 }, (_, n) =>
        Array.from({ length: 15 }, (_, i) => `request${n}word${i}`).join(" "),
      ),
      useCases: Array.from({ length: 6 }, (_, n) => `use case number ${n} here`),
      synonyms: Array.from({ length: 10 }, (_, n) => `synonym phrase number ${n} here`),
      goodFor: [],
      notFor: [],
    }),
  );
  expect(rows(await validateSearch(f.root, f))).toEqual([
    { check: "search-size", severity: "warning", kind: "stack", entry: "sample" },
  ]);
});

test.each([
  { caveats: ["one", "two", "three", "four"] },
  { caveats: [Array.from({ length: 30 }, () => "word").join(" ")] },
])("caveat limits warn: %j [4.5b#13c]", { timeout: 15_000 }, async (overrides) => {
  const f = setup();
  put(cardPath(f.root, sample), JSON.stringify({ ...(await stamp(f.root, sample)), ...overrides }));
  expect(rows(await validateSearch(f.root, f))).toEqual([
    { check: "search-size", severity: "warning", kind: "stack", entry: "sample" },
  ]);
});

test.each([
  { requests: Array.from({ length: 6 }, (_, n) => `request ${n}`) },
  { useCases: Array.from({ length: 7 }, (_, n) => `case ${n}`) },
  { synonyms: Array.from({ length: 13 }, (_, n) => `alias ${n}`) },
  { goodFor: Array.from({ length: 5 }, (_, n) => `use ${n}`) },
  { notFor: Array.from({ length: 5 }, (_, n) => `avoid ${n}`) },
  { languages: ["typescript", "python", "go", "rust"] },
])(
  "field counts warn without rejecting text: %j [4.5b#7]",
  { timeout: 15_000 },
  async (overrides) => {
    const f = setup();
    put(
      cardPath(f.root, sample),
      JSON.stringify({ ...(await stamp(f.root, sample)), ...overrides }),
    );
    expect(rows(await validateSearch(f.root, f))).toEqual([
      { check: "search-size", severity: "warning", kind: "stack", entry: "sample" },
    ]);
  },
);

test("caveats are optional and empty fragment capabilities decode [4.5b#13c] [4.5b#13d]", async () => {
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  expect(Schema.decodeUnknownSync(SearchMetadata)(card(sample))).not.toHaveProperty("caveats");
  expect(
    Schema.decodeUnknownSync(SearchMetadata)(card({ kind: "fragment", id: "tools" })),
  ).toMatchObject({ capabilities: [] });
});

test.each([
  { ref: sample, change: { capabilities: ["auth"] }, omitLanguages: false },
  { ref: sample, change: {}, omitLanguages: true },
  {
    ref: { kind: "fragment", id: "tools" } as const,
    change: { platforms: ["ios"] },
    omitLanguages: false,
  },
])("cards enforce the kind union: %j [4.5b#13d]", async ({ ref, change, omitLanguages }) => {
  const f = setup();
  if (ref.kind === "fragment") {
    rmSync(join(f.root, "stacks"), { recursive: true });
    seed(f.root, ref);
  }
  const value = card(ref);
  const withoutLanguages = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "languages"),
  );
  put(
    cardPath(f.root, ref),
    JSON.stringify({ ...(omitLanguages ? withoutLanguages : value), ...change }),
  );
  expect(rows(await validateSearch(f.root, f))).toEqual([
    { check: "search-invalid", severity: "error", kind: ref.kind, entry: ref.id },
  ]);
});

test("project vocabulary is ignored even when malformed [4.5b#13b]", {
  timeout: 15_000,
}, async () => {
  const home = space.dir();
  const root = join(home, ".stacks");
  seed(root, sample);
  const value = await stamp(root, sample);
  put(join(root, "search/vocabulary.json"), "not JSON; redefine iphone as cli");
  expect(rows(await validateSearch(root, { home }))).toEqual([
    { check: "vocabulary-ignored", severity: "note", kind: undefined, entry: undefined },
  ]);
  // Ranking belongs to 4.5c. A project card still validates against the bundled vocabulary.
  put(cardPath(root, sample), JSON.stringify({ ...value, platforms: ["ios"] }));
  expect(rows(await validateSearch(root, { home }))).toEqual([
    { check: "vocabulary-ignored", severity: "note", kind: undefined, entry: undefined },
  ]);
});

// Two stamps and two validate runs; under a loaded gate host this passes 5 s.
test("a shared stack and fragment id keeps two independent cards [4.5b#15]", {
  timeout: 15_000,
}, async () => {
  const f = setup();
  const fragment = { kind: "fragment", id: sample.id } as const;
  seed(f.root, fragment);
  await stamp(f.root, sample);
  const fragmentCard = await stamp(f.root, fragment);
  expect(rows(await validateSearch(f.root, f))).toEqual([]);
  put(
    cardPath(f.root, fragment),
    JSON.stringify({
      ...fragmentCard,
      source: { ...fragmentCard.source, reviewedAt: null },
    }),
  );
  expect(rows(await validateSearch(f.root, f))).toEqual([
    { check: "search-unreviewed", severity: "warning", kind: "fragment", entry: sample.id },
  ]);
});

test("repeated text in a project card warns but still decodes [4.5b#16]", async () => {
  const home = space.dir();
  const root = join(home, ".stacks");
  seed(root, sample);
  put(
    cardPath(root, sample),
    JSON.stringify({
      ...(await stamp(root, sample)),
      requests: [
        Array.from({ length: 50 }, () => "utility").join(" "),
        "inspect build logs",
        "rename local receipts",
      ],
    }),
  );
  expect(rows(await validateSearch(root, { home }))).toEqual([
    { check: "search-size", severity: "warning", kind: "stack", entry: "sample" },
  ]);
  const result = await runCli(["list", "--json"], {
    home,
    env: quiet,
    host: { cwd: home, registry: bundled },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    Schema.decodeUnknownSync(ListResult)(JSON.parse(result.stdout)).entries.find(
      (row) => row.id === sample.id && row.kind === sample.kind,
    ),
  ).toMatchObject({ trusted: false, origin: "project" });
});

test.each(["bom", "crlf"])(
  "sidecar %s text decodes identically [4.5b#17]",
  {
    timeout: 15_000,
  },
  async (encoding) => {
    const f = setup();
    await stamp(f.root, sample);
    const before = searchFindings(await validateSearch(f.root, f));
    const text = readFileSync(cardPath(f.root, sample), "utf8");
    put(
      cardPath(f.root, sample),
      encoding === "bom" ? `\uFEFF${text}` : text.replaceAll("\n", "\r\n"),
    );
    expect(searchFindings(await validateSearch(f.root, f))).toEqual(before);
    expect(before).toEqual([]);
  },
);

test("a root containing only search cards has no entries and reports all orphans [4.5b#18]", async () => {
  const home = space.dir();
  const root = join(home, "only cards");
  for (const ref of [sample, { kind: "fragment", id: "tools" } as const])
    put(cardPath(root, ref), JSON.stringify(card(ref)));
  const report = await validateSearch(root, { home });
  expect(report.entries).toEqual({ stacks: 0, fragments: 0 });
  expect(rows(report)).toEqual([
    { check: "search-orphan", severity: "error", kind: "stack", entry: "sample" },
    { check: "search-orphan", severity: "error", kind: "fragment", entry: "tools" },
  ]);
  const result = await runCli(["list", "--json"], { home, env: quiet, host: { registry: root } });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(Schema.decodeUnknownSync(ListResult)(JSON.parse(result.stdout))).toMatchObject({
    entries: [],
    rejected: [],
  });
});
