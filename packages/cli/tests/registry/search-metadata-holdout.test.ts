import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ListResult } from "../../src/schemas/list";
import { quiet, runCli } from "../helpers/cli";
import { GoldenSet } from "../helpers/search-golden";
import { card, cardPath, entryAt, put, readJson } from "../helpers/search-metadata";
import { workspace } from "../helpers/verify";
import { bundled } from "./helpers/bundled";

const space = workspace();
afterEach(() => space.release());

const golden = Schema.decodeUnknownSync(GoldenSet)(
  readJson(join(import.meta.dirname, "fixtures/search/golden.json")),
);
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .join(" ");
function leaks(id: string, requests: readonly string[]) {
  return golden.queries
    .filter(({ split }) => split === "holdout")
    .flatMap((query) => {
      const words = normalize(query.query).split(" ");
      const runs = words.flatMap((_, i) =>
        i + 5 <= words.length ? [words.slice(i, i + 5).join(" ")] : [],
      );
      return requests.flatMap((request) => {
        const text = ` ${normalize(request)} `;
        return text.includes(` ${normalize(query.query)} `) ||
          runs.some((run) => text.includes(` ${run} `))
          ? [`${id}: request leaks holdout ${query.id}`]
          : [];
      });
    });
}
async function bundledEntries() {
  const result = await runCli(["list", "--json"], { host: { registry: bundled }, env: quiet });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return Schema.decodeUnknownSync(ListResult)(JSON.parse(result.stdout)).entries;
}

test("every drafting prompt including examples excludes golden query strings [4.5b#13a]", async () => {
  const { buildPrompt, PROMPT_VERSION } = await import("../../scripts/decorate/prompt");
  const { SearchMetadata, SearchVocabulary } = await import("@steamfield/stacks-format");
  const entries = await bundledEntries();
  const cards = entries.map((entry) =>
    Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(bundled, entry))),
  );
  const examples = cards.filter(({ source }) => source.reviewedAt !== null).slice(0, 2);
  expect(examples).toHaveLength(2);
  expect(PROMPT_VERSION).toBeGreaterThan(0);
  const vocabulary = Schema.decodeUnknownSync(SearchVocabulary)(
    readJson(join(bundled, "search/vocabulary.json")),
  );
  // A query that is itself a closed-vocabulary alias ("go cli") reaches every prompt through the
  // vocabulary, which is matched literally; only the rest could leak into drafted wording.
  const aliases = new Set(
    Object.values(vocabulary)
      .flatMap((field) => (typeof field === "object" ? Object.values(field).flat() : []))
      .map((alias) => alias.toLowerCase()),
  );
  const queries = golden.queries.filter((query) => !aliases.has(query.query.toLowerCase()));
  for (const ref of entries) {
    const prompt = buildPrompt({ entry: await entryAt(bundled, ref), vocabulary, examples });
    expect(prompt).toContain(ref.id);
    expect(prompt).toContain(examples[0]?.summary);
    expect(prompt).toContain(examples[1]?.summary);
    for (const query of queries)
      expect(prompt.toLowerCase(), `${ref.id}: ${query.id}`).not.toContain(
        query.query.toLowerCase(),
      );
  }
});

test("bundled requests have no holdout copies or five-word runs [4.5b#13a]", async () => {
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  const problems: string[] = [];
  for (const ref of await bundledEntries()) {
    const value = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(bundled, ref)));
    problems.push(...leaks(`${ref.kind}/${ref.id}`, value.requests));
  }
  expect(problems).toEqual([]);
});

test("the leak guard names card and query for copies, containment and normalized five-word runs [4.5b#13a]", async () => {
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  const root = space.dir();
  const ref = { kind: "stack", id: "copied-holdout" } as const;
  const query = golden.queries.find(
    (q) => q.split === "holdout" && normalize(q.query).split(" ").length >= 6,
  );
  if (!query) throw new Error("Golden set needs a holdout with at least six words");
  const five = normalize(query.query).split(" ").slice(0, 5).join(", ").toUpperCase();
  for (const request of [
    query.query,
    `Please ${query.query} now`,
    `prefix ${five} unrelated suffix`,
  ]) {
    put(
      cardPath(root, ref),
      JSON.stringify({
        ...card(ref),
        requests: [request, "batch rename receipts", "inspect build logs"],
      }),
    );
    const fixture = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(root, ref)));
    expect(leaks(`${fixture.kind}/${fixture.id}`, fixture.requests)).toContain(
      `stack/copied-holdout: request leaks holdout ${query.id}`,
    );
  }
  expect(leaks("stack/clean", ["batch rename receipts safely"])).toEqual([]);
});
