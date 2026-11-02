// Acceptance tests over the real build in dist/. `make build` runs them after
// `astro build`. The page list comes from src/content/docs, not from the build.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { site } from "../src/config";

const parser = new new Window().DOMParser();
const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
const page = (root: string, path: string) => parser.parseFromString(read(root, path), "text/html");
const absolute = (path: string) => new URL(path, site.url).href;
const pagePath = (id: string) => `docs/${id}/index.html`;

function sourceDocs(root = ".") {
  const base = join(root, "src/content/docs");
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(readFileSync(join(base, file), "utf8"));
      return { id: file.replace(/\.md$/, "").replaceAll("\\", "/"), title: title?.[1] ?? "" };
    });
}

function htmlFiles(root: string) {
  return readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".html"),
  );
}

function islandNames(root: string, path: string) {
  return [...page(root, path).querySelectorAll("astro-island")].map(
    (island) => JSON.parse(island.getAttribute("opts") ?? "{}").name as string,
  );
}

const docs = sourceDocs();

describe("docs pages", () => {
  it.each(docs)("$id renders its metadata, sidebar entry and exports", ({ id, title }) => {
    const doc = page("dist", pagePath(id));
    const href = `/docs/${id}/`;
    expect(doc.querySelector("h1")?.textContent).toBe(title);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBeTruthy();
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(absolute(href));
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      absolute(`/og/docs/${id}.png`),
    );
    expect(
      doc.querySelector('link[rel="alternate"][type="text/markdown"]')?.getAttribute("href"),
    ).toBe(`/docs/${id}.md`);
    expect(
      doc.querySelector('nav[aria-label="Docs"] a[aria-current="page"]')?.getAttribute("href"),
    ).toBe(href);
    expect(read("dist", `docs/${id}.md`).startsWith(`# ${title}\n`)).toBe(true);
    expect(read("dist", "llms.txt")).toContain(absolute(`/docs/${id}.md`));
    expect(read("dist", "llms-full.txt")).toContain(`# ${title}\n`);
    expect(read("dist", "sitemap-0.xml")).toContain(`<loc>${absolute(href)}</loc>`);
    const png = readFileSync(`dist/og/docs/${id}.png`);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("renders the Markdown conventions", () => {
    const html = docs.map(({ id }) => read("dist", pagePath(id))).join("\n");
    expect(html).toMatch(/<aside class="callout callout-note">/);
    expect(html).toMatch(/<figcaption>Terminal<\/figcaption>/);
    expect(html).toMatch(/<div class="table-scroll" tabindex="0" role="region"/);
    expect(html).toMatch(/<a class="heading-anchor" href="#[\w-]+"/);
    expect(html).toMatch(/--shiki-dark:/);
  });

  it("lists every page on the docs home", () => {
    const home = page("dist", "docs/index.html");
    for (const { id } of docs) {
      expect(home.querySelector(`main a[href="/docs/${id}/"]`), id).not.toBeNull();
    }
  });
});

describe("the whole site", () => {
  it("has no broken internal links or anchors", () => {
    const broken: string[] = [];
    for (const file of htmlFiles("dist")) {
      const self = `/${file.replace(/index\.html$/, "")}`;
      for (const link of page("dist", file).querySelectorAll("a[href]")) {
        const href = link.getAttribute("href") ?? "";
        if (!href.startsWith("/") && !href.startsWith("#")) continue;
        if (href.startsWith("//")) continue;
        const [path = "", hash] = (href.startsWith("#") ? `${self}${href}` : href).split("#");
        const target = path.endsWith("/") ? `${path}index.html` : path;
        if (!existsSync(join("dist", target))) {
          broken.push(`${file}: ${href}`);
        } else if (hash && target.endsWith(".html")) {
          if (!page("dist", target).getElementById(decodeURIComponent(hash))) {
            broken.push(`${file}: ${href} (no #${hash})`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("hydrates only the islands site.islands lists, and none on docs pages", () => {
    expect([...new Set(islandNames("dist", "index.html"))].sort()).toEqual(
      [...site.islands].sort(),
    );
    for (const file of htmlFiles("dist").filter((file) => file.startsWith("docs"))) {
      expect(islandNames("dist", file), file).toEqual([]);
    }
  });

  it("renders the landing page from config, hiding empty sections", () => {
    const home = page("dist", "index.html");
    expect(home.querySelector("h1")?.textContent).toBe(site.tagline);
    expect(home.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      absolute("/og/index.png"),
    );
    const text = home.body.textContent ?? "";
    expect(text).toContain(site.install[0]?.command ?? "");
    for (const line of site.demo.lines) expect(text).toContain(line.text);
    if (site.announcement) expect(text).toContain(site.announcement.label);
    if (site.version) expect(text).toContain(`v${site.version}`);
    expect(text).toContain(`${site.license} license`);
    const headings = [...home.querySelectorAll("h2")].map((heading) => heading.textContent);
    expect(headings.includes("Used by")).toBe(site.usedBy.length > 0);
    expect(headings.includes("Sponsors")).toBe(site.sponsors.logos.length > 0);
    expect(readFileSync("dist/og/index.png").subarray(1, 4).toString()).toBe("PNG");
  });

  it("serves robots.txt, the sitemap index and an unindexed 404 page", () => {
    expect(read("dist", "robots.txt")).toContain(`Sitemap: ${absolute("/sitemap-index.xml")}`);
    expect(existsSync("dist/sitemap-index.xml")).toBe(true);
    expect(read("dist", "sitemap-0.xml")).not.toMatch(/404|\.md<|\.png<|\.txt</);
    const notFound = page("dist", "404.html");
    expect(notFound.querySelector("h1")?.textContent).toBe("Page not found");
    expect(notFound.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex, nofollow",
    );
  });
});

describe("adding a docs page", () => {
  it("is one file: navigation, pager, exports and sitemap pick it up", () => {
    const root = mkdtempSync(join(tmpdir(), "site-build-"));
    try {
      for (const entry of ["src", "public", "astro.config.mjs", "tsconfig.json", "package.json"]) {
        cpSync(entry, join(root, entry), { recursive: true });
      }
      symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
      writeFileSync(
        join(root, "src/content/docs/guides/probe-page.md"),
        "---\ntitle: Probe page\ndescription: Checks that a new page is wired in.\ngroup: guides\norder: -1000\n---\n\n## Probe heading\n\nProbe body.\n",
      );
      const built = spawnSync("bunx", ["--no-install", "astro", "build"], {
        cwd: root,
        encoding: "utf8",
        timeout: 150_000,
      });
      expect(built.status, `${built.stdout}\n${built.stderr}`).toBe(0);
      const dist = join(root, "dist");
      const href = "/docs/guides/probe-page/";
      const other = page(dist, pagePath(docs[0]?.id ?? ""));
      expect(other.querySelector(`nav[aria-label="Docs"] a[href="${href}"]`)).not.toBeNull();
      // order -1000 makes the probe its group's first page, so another page links back to it.
      const linksBack = docs.some(
        ({ id }) =>
          page(dist, pagePath(id)).querySelector(`a[rel="prev"][href="${href}"]`) !== null,
      );
      expect(linksBack).toBe(true);
      expect(
        page(dist, pagePath("guides/probe-page")).querySelector("#probe-heading"),
      ).not.toBeNull();
      expect(read(dist, "docs/guides/probe-page.md")).toContain("Probe body.");
      expect(read(dist, "llms.txt")).toContain(absolute("/docs/guides/probe-page.md"));
      expect(read(dist, "sitemap-0.xml")).toContain(absolute(href));
      expect(existsSync(join(dist, "og/docs/guides/probe-page.png"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
