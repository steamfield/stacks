// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { frontmatter } from "../scripts/frontmatter.mjs";
import { postSchema } from "../src/content/schema";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
test("new-article writes a schema-valid draft with a quoted title and refuses overwrites", () => {
  const cwd = mkdtempSync(join(tmpdir(), "blog-post-"));
  dirs.push(cwd);
  const env = {
    ...process.env,
    SLUG: "first-post",
    TITLE: 'A "quoted": title',
  };
  const run = (slug: string) =>
    spawnSync("bun", [resolve("scripts/new-article.mjs")], {
      cwd,
      env: { ...env, SLUG: slug },
      encoding: "utf8",
    });
  const result = run("first-post");
  expect(result.status, result.stderr).toBe(0);
  const source = readFileSync(
    join(cwd, "src/content/blog/first-post.mdx"),
    "utf8",
  );
  expect(postSchema.parse(frontmatter(source))).toMatchObject({
    title: env.TITLE,
    status: "draft",
  });
  expect(run("first-post").status).not.toBe(0);
  expect(
    readFileSync(join(cwd, "src/content/blog/first-post.mdx"), "utf8"),
  ).toBe(source);
  expect(run("../escape").status).not.toBe(0);
});

test.each(["legacy.md", "legacy/index.mdx"])(
  "new-article refuses a slug already owned by %s",
  (filename) => {
    const cwd = mkdtempSync(join(tmpdir(), "blog-post-"));
    dirs.push(cwd);
    mkdirSync(join(cwd, "src/content/blog"), { recursive: true });
    const original = readFileSync("src/content/blog/welcome.mdx", "utf8");
    const existing = join(cwd, "src/content/blog", filename);
    mkdirSync(dirname(existing), { recursive: true });
    writeFileSync(existing, original);
    const result = spawnSync("bun", [resolve("scripts/new-article.mjs")], {
      cwd,
      env: { ...process.env, SLUG: "legacy", TITLE: "Replacement" },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already exists");
    expect(existsSync(join(cwd, "src/content/blog/legacy.mdx"))).toBe(false);
    expect(readFileSync(existing, "utf8")).toBe(original);
  },
);
