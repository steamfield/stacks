import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ListResult } from "../../src/schemas/list";
import { quiet, runCli } from "../helpers/cli";
import {
  cardPath,
  readJson,
  searchFindings,
  seed,
  stamp,
  validateSearch,
} from "../helpers/search-metadata";
import { workspace } from "../helpers/verify";
import { bundled } from "./helpers/bundled";

const space = workspace();
afterEach(() => space.release());
const sample = { kind: "stack", id: "sample" } as const;
function setup() {
  const home = space.dir();
  const root = join(home, "registry café");
  seed(root, sample);
  return { home, root };
}

// That every card is current (no search-stale or other warning) is asserted against the suite's one
// whole-registry report, in tests/registry/bundled-registry.test.ts.
test("every bundled entry has a reviewed card [4.5b#1]", async () => {
  const home = space.dir();
  const listing = await runCli(["list", "--json"], {
    home,
    host: { registry: bundled },
    env: quiet,
  });
  expect(listing.status, listing.stderr).toBe(0);
  expect(listing.stderr).toBe("");
  const entries = Schema.decodeUnknownSync(ListResult)(JSON.parse(listing.stdout)).entries;
  expect(entries.some(({ kind }) => kind === "stack")).toBe(true);
  expect(entries.some(({ kind }) => kind === "fragment")).toBe(true);
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  for (const entry of entries) {
    const value = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(bundled, entry)));
    expect(value.source.reviewedAt, `${entry.kind}/${entry.id}`).not.toBeNull();
    expect(value.kind).toBe(entry.kind);
    expect(value.id).toBe(entry.id);
  }
}, 30_000);

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
  expect(searchFindings(await validateSearch(f.root, { ...f, registry: bundled }))).toEqual([]);
});
