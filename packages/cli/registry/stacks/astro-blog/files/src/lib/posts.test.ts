import { expect, test } from "vitest";
import { publishedPosts, readingTime, routablePosts, slugFor } from "./posts";

const entries = [
  {
    id: "older.md",
    data: { status: "published", date: new Date("2025-01-01") },
  },
  { id: "draft.mdx", data: { status: "draft", date: new Date("2026-01-03") } },
  {
    id: "unlisted",
    data: { status: "unlisted", date: new Date("2026-01-02") },
  },
  { id: "newer", data: { status: "published", date: new Date("2026-01-01") } },
] satisfies Parameters<typeof publishedPosts>[0];

test("only published posts appear in listings, newest first, without mutating input", () => {
  expect(publishedPosts(entries).map(slugFor)).toEqual(["newer", "older"]);
  expect(entries[0]?.id).toBe("older.md");
});
test("production includes unlisted routes and dev also includes drafts", () => {
  expect(routablePosts(entries, false).map(slugFor)).toEqual([
    "older",
    "unlisted",
    "newer",
  ]);
  expect(routablePosts(entries, true)).toEqual(entries);
});
test("slugs keep nested paths and reading time has a one minute minimum", () => {
  expect(slugFor({ id: "notes/hello.mdx" })).toBe("notes/hello");
  expect(slugFor({ id: "notes/index.mdx" })).toBe("notes");
  expect(readingTime("")).toBe(1);
  expect(readingTime("word ".repeat(201))).toBe(2);
});
