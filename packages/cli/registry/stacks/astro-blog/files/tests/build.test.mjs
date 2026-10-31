import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Window } from "happy-dom";

const read = (path) => readFileSync(`dist/${path}`, "utf8");
const document = (path) => {
  const window = new Window();
  window.document.write(read(path));
  return window.document;
};

test("the built post renders MDX, metadata, canonical and an island", () => {
  const page = document("welcome.html");
  assert.equal(
    page.querySelector("h1")?.textContent,
    "Welcome to the field notes",
  );
  assert.ok(
    page.querySelector("h2")?.textContent.includes("small observation"),
  );
  assert.ok(page.querySelector("time")?.getAttribute("datetime"));
  assert.equal(
    page.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    "https://example.com/welcome",
  );
  assert.equal(
    page.querySelector('meta[property="og:url"]')?.getAttribute("content"),
    "https://example.com/welcome",
  );
  assert.ok(page.querySelector("astro-island"));
  assert.ok(read("default-og.svg").includes("<svg"));
});
test("index, RSS and sitemap agree on the published route", () => {
  assert.ok(document("index.html").querySelector('a[href="/welcome"]'));
  assert.match(read("rss.xml"), /<link>https:\/\/example.com\/welcome<\/link>/);
  assert.match(
    read("sitemap-0.xml"),
    /<loc>https:\/\/example.com\/welcome<\/loc>/,
  );
  assert.doesNotMatch(read("sitemap-0.xml"), /\/404|\/og\//);
});
test("the error page tells readers how to recover and stays out of search", () => {
  const page = document("404.html");
  assert.equal(page.querySelector("h1")?.textContent, "Page not found");
  assert.ok(page.querySelector('a[href="/"]'));
  assert.equal(
    page.querySelector('meta[name="robots"]')?.getAttribute("content"),
    "noindex, nofollow",
  );
});

test("syntax highlighting supplies light colors and applies dark colors through the theme", () => {
  const page = document("welcome.html");
  const token = page.querySelector(".astro-code span[style]");
  assert.match(token?.getAttribute("style") ?? "", /color:/);
  assert.match(token?.getAttribute("style") ?? "", /--shiki-dark:/);
  const styles = [...page.querySelectorAll('link[rel="stylesheet"]')]
    .map((link) => read(link.getAttribute("href").replace(/^\//, "")))
    .join("\n");
  assert.match(styles, /\.dark \.astro-code/);
  assert.match(styles, /color:\s*var\(--shiki-dark\)\s*!important/);
  assert.match(
    styles,
    /background-color:\s*var\(--shiki-dark-bg\)\s*!important/,
  );
});

test("a production build hides drafts and renders unlisted posts without listing them", () => {
  const root = mkdtempSync(join(tmpdir(), "blog-build-"));
  try {
    for (const file of [
      "src",
      "public",
      "scripts",
      "astro.config.mjs",
      "tsconfig.json",
      "package.json",
    ]) {
      cpSync(file, join(root, file), { recursive: true });
    }
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    for (const status of ["draft", "unlisted"]) {
      writeFileSync(
        join(root, `src/content/blog/${status}.mdx`),
        `---\ntitle: ${status}\ndescription: Visibility probe\nauthor: Author\ndate: 2026-01-02\nstatus: ${status}\n---\n\nVisibility probe.\n`,
      );
    }
    mkdirSync(join(root, "src/content/blog/notes"));
    writeFileSync(
      join(root, "src/content/blog/notes/index.mdx"),
      `---\ntitle: Nested post\ndescription: Nested index probe\nauthor: Author\ndate: 2026-01-02\nstatus: published\n---\n\nNested content.\n`,
    );
    const built = spawnSync("bunx", ["--no-install", "astro", "build"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    assert.equal(existsSync(join(root, "dist/notes.html")), true);
    for (const file of ["index.html", "rss.xml", "sitemap-0.xml"]) {
      assert.match(
        readFileSync(join(root, "dist", file), "utf8"),
        /\/notes[<"]/,
      );
    }
    assert.equal(existsSync(join(root, "dist/draft.html")), false);
    const hidden = new Window().document;
    hidden.write(readFileSync(join(root, "dist/unlisted.html"), "utf8"));
    assert.equal(hidden.querySelector("h1")?.textContent, "unlisted");
    assert.equal(
      hidden.querySelector('meta[name="robots"]')?.getAttribute("content"),
      "noindex, nofollow",
    );
    for (const file of ["index.html", "rss.xml", "sitemap-0.xml"]) {
      assert.doesNotMatch(
        readFileSync(join(root, "dist", file), "utf8"),
        /\/(draft|unlisted)(?:[<"/]|$)/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
