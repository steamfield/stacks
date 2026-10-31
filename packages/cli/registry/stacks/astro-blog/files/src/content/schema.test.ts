// @vitest-environment node
import { globSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { frontmatter } from "../../scripts/frontmatter.mjs";
import { postSchema } from "./schema";

const valid = {
  title: "Hello",
  description: "A post",
  date: "2026-01-01",
  author: "Author",
};
test("valid frontmatter coerces dates and defaults status and tags", () => {
  expect(postSchema.parse(valid)).toMatchObject({
    date: new Date("2026-01-01"),
    status: "published",
    tags: [],
  });
});
test("missing titles, unknown statuses and invalid dates fail validation", () => {
  const { title, ...missingTitle } = valid;
  expect(postSchema.safeParse(missingTitle).success).toBe(false);
  expect(postSchema.safeParse({ ...valid, status: "private" }).success).toBe(
    false,
  );
  expect(postSchema.safeParse({ ...valid, date: "not a date" }).success).toBe(
    false,
  );
});
test("every real post parses as YAML and passes the collection schema", () => {
  const files = Array.from(globSync("src/content/blog/**/*.{md,mdx}"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files)
    expect(
      () => postSchema.parse(frontmatter(readFileSync(file, "utf8"))),
      file,
    ).not.toThrow();
});
