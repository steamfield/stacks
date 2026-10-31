import { globSync, mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { site } from "../src/config.ts";
import { slugFor } from "../src/lib/posts.ts";

const { SLUG = "", TITLE = "" } = process.env;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(SLUG) || !TITLE.trim()) {
  throw new Error(
    "Set SLUG to lowercase words joined by hyphens and TITLE to a nonempty title.",
  );
}
mkdirSync("src/content/blog", { recursive: true });
if (
  Array.from(globSync("src/content/blog/**/*.{md,mdx}")).some(
    (file) => slugFor({ id: relative("src/content/blog", file) }) === SLUG,
  )
) {
  throw new Error(`A post with slug ${SLUG} already exists.`);
}
// JSON strings are YAML scalars, including titles containing quotes or newlines.
const post = `---\ntitle: ${JSON.stringify(TITLE)}\ndescription: ${JSON.stringify(TITLE)}\ndate: ${new Date().toISOString().slice(0, 10)}\nauthor: ${JSON.stringify(site.author)}\nstatus: draft\n---\n\nWrite your post here.\n`;
writeFileSync(`src/content/blog/${SLUG}.mdx`, post, { flag: "wx" });
console.log(`Created draft: src/content/blog/${SLUG}.mdx`);
