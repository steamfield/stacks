import { Schema } from "effect";
import { expect, test } from "vitest";
import * as api from "../src/index";
import { IndexEntry, RegistryIndex } from "../src/index-schema";

const digest = `sha256:${"a".repeat(64)}`;
const entry = {
  id: "sample",
  kind: "stack",
  schemaVersion: 1,
  name: "Sample",
  description: "A stack.",
  tags: [],
  digest,
  composition: {},
};
const index = (entries: unknown[]) => ({
  formatVersion: 1,
  minCli: "0.5.0",
  generatedAt: "2026-10-27T00:00:00Z",
  commit: "a".repeat(40),
  entries,
});

const decodes = (schema: Schema.Decoder<unknown>, value: unknown) =>
  Schema.decodeUnknownExit(schema)(value)._tag === "Success";

test("authors exports come through the package boundary", () => {
  expect(api.authorKey("stack", "web")).toBe("stack/web");
  expect(api.authorKey("fragment", "docs")).toBe("fragment/docs");
  expect(decodes(api.AuthorsFile, {})).toBe(true);
  expect(decodes(api.GitHubLogin, "octo-cat")).toBe(true);
});

test.each(["a", "octo-cat", "Octo1", "a".repeat(39), "a-b-c"])("%s is a GitHub login", (login) => {
  expect(decodes(api.GitHubLogin, login)).toBe(true);
});

test.each(["", "-octo", "octo-", "octo--cat", "a".repeat(40), "octo_cat", "octo cat", "@octo"])(
  "%j is not a GitHub login",
  (login) => {
    expect(decodes(api.GitHubLogin, login)).toBe(false);
  },
);

test("an authors file maps stack and fragment keys to logins", () => {
  expect(decodes(api.AuthorsFile, { "stack/web": "octo-cat", "fragment/docs": "a1" })).toBe(true);
});

test.each([
  [{ "app/web": "octo" }],
  [{ web: "octo" }],
  [{ "stack/Web": "octo" }],
  [{ "stack/": "octo" }],
  [{ "/web": "octo" }],
  [{ "stack/web/extra": "octo" }],
  [{ "stack/web": "-octo" }],
  [{ "stack/web": 7 }],
  [[]],
])("an authors file rejects %j", (value) => {
  expect(decodes(api.AuthorsFile, value)).toBe(false);
});

test("an index entry may carry a valid author and rejects an invalid one", () => {
  expect(decodes(RegistryIndex, index([{ ...entry, author: "octo-cat" }]))).toBe(true);
  expect(decodes(RegistryIndex, index([entry]))).toBe(true);
  expect(decodes(RegistryIndex, index([{ ...entry, author: "-octo" }]))).toBe(false);
});

test("a reader without the author field still decodes an index that has one", () => {
  // Released CLIs decode IndexEntry without `author`; excess keys must not fail them.
  const { author: _author, ...fields } = IndexEntry.fields;
  const older = Schema.Struct({
    ...RegistryIndex.fields,
    entries: Schema.Array(Schema.Struct(fields)),
  });
  const decoded = Schema.decodeUnknownSync(older)(index([{ ...entry, author: "octo-cat" }]));
  expect(decoded.entries[0]).not.toHaveProperty("author");
});
