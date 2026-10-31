import { join } from "node:path";
import type { IndexEntry } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { toRow } from "../src/core/list";
import { ListResult } from "../src/schemas/list";
import { ShowReport } from "../src/schemas/show";
import { quiet, runCli } from "./helpers/cli";
import { entryAt, put, seed, validateSearch } from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

/** A registry root holding stack/sample and fragment/tools, with the given authors.json text. */
function registry(authors: string) {
  const home = space.dir();
  const root = join(home, "registry");
  seed(root, { kind: "stack", id: "sample" });
  seed(root, { kind: "fragment", id: "tools" });
  put(join(root, "authors.json"), authors);
  return { home, root };
}

const authorFindings = async (authors: string) => {
  const { home, root } = registry(authors);
  const report = await validateSearch(root, { home });
  return report.findings
    .filter((finding) => finding.check.startsWith("authors-"))
    .map(({ check, severity, file }) => ({ check, severity, file }));
};

test("an authors.json naming only existing entries passes", async () => {
  expect(await authorFindings(JSON.stringify({ "stack/sample": "octo-cat" }))).toEqual([]);
});

test("an authors.json key naming no entry is an authors-orphan error", async () => {
  expect(
    await authorFindings(JSON.stringify({ "stack/sample": "octo-cat", "fragment/gone": "octo" })),
  ).toEqual([{ check: "authors-orphan", severity: "error", file: "authors.json" }]);
});

test.each([
  JSON.stringify({ "stack/sample": "-octo" }),
  JSON.stringify({ "app/sample": "octo" }),
  "not json",
])("an undecodable authors.json is an authors-invalid error: %s", async (text) => {
  expect(await authorFindings(text)).toEqual([
    { check: "authors-invalid", severity: "error", file: "authors.json" },
  ]);
});

test("list and show carry the author authors.json names for a bundled entry", async () => {
  const { home, root } = registry(JSON.stringify({ "stack/sample": "octo-cat" }));
  const run = (args: string[]) => runCli(args, { home, host: { registry: root }, env: quiet });
  const list = await run(["list", "--json"]);
  expect(list.status, list.stderr).toBe(0);
  const rows = Schema.decodeUnknownSync(ListResult)(JSON.parse(list.stdout)).entries;
  expect(rows.find((row) => row.id === "sample")?.author).toBe("octo-cat");
  expect(rows.find((row) => row.id === "tools")).not.toHaveProperty("author");
  const show = await run(["show", "sample", "--json"]);
  expect(show.status, show.stderr).toBe(0);
  expect(Schema.decodeUnknownSync(ShowReport)(JSON.parse(show.stdout)).author).toBe("octo-cat");
  const human = await run(["show", "sample"]);
  expect(human.stdout).toContain("Author: @octo-cat");
  const uncredited = await run(["show", "tools"]);
  expect(uncredited.stdout).not.toContain("Author:");
});

test("an index entry's author reaches its row; authors.json credits only bundled entries", async () => {
  const { root } = registry("{}");
  const entry = await entryAt(root, { kind: "stack", id: "sample" });
  const indexEntry: IndexEntry = {
    id: "sample",
    kind: "stack",
    schemaVersion: 1,
    name: "sample",
    description: "A stack.",
    tags: [],
    digest: `sha256:${"a".repeat(64)}`,
    composition: {},
    author: "octo-cat",
  };
  expect(toRow({ ...entry, origin: "index", indexEntry }).author).toBe("octo-cat");
  const user = { ...entry, origin: "user" as const };
  expect(toRow(user, [], { "stack/sample": "octo-cat" })).not.toHaveProperty("author");
});
