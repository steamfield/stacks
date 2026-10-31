import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  card,
  cardPath,
  put,
  searchFindings,
  seed,
  validateSearch,
} from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

const ref = { kind: "stack", id: "sample" } as const;

/** The search findings for one stale card with the given review fields, as check and severity. */
async function staleCard(source: { by: "author" | "drafted"; reviewedAt: string | null }) {
  const home = space.dir();
  const root = join(home, "config/stacks");
  seed(root, ref);
  // The default digest never matches the entry text, so the card is stale.
  const stale = card(ref);
  put(cardPath(root, ref), JSON.stringify({ ...stale, source: { ...stale.source, ...source } }));
  return searchFindings(await validateSearch(root, { home })).map(({ check, severity }) => ({
    check,
    severity,
  }));
}

test("a stale unreviewed author draft is a note, not a warning", async () => {
  expect(await staleCard({ by: "author", reviewedAt: null })).toEqual([
    { check: "search-unreviewed", severity: "warning" },
    { check: "search-stale", severity: "note" },
  ]);
});

test("a stale reviewed author card stays a warning", async () => {
  expect(await staleCard({ by: "author", reviewedAt: "2020-01-01" })).toEqual([
    { check: "search-stale", severity: "warning" },
  ]);
});

test("a stale unreviewed drafted card stays a warning", async () => {
  expect(await staleCard({ by: "drafted", reviewedAt: null })).toEqual([
    { check: "search-stale", severity: "warning" },
    { check: "search-unreviewed", severity: "warning" },
  ]);
});
