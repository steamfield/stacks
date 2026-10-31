import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwind from "@tailwindcss/vite";
import { globSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { defineConfig } from "astro/config";
import { frontmatter } from "./scripts/frontmatter.mjs";
import { site } from "./src/config.ts";
import { publishedPosts, slugFor } from "./src/lib/posts.ts";
import { postSchema } from "./src/content/schema.ts";

// Config runs before astro:content exists. Decode the same schema from real YAML.
const entries = Array.from(globSync("src/content/blog/**/*.{md,mdx}")).map(
  (file) => ({
    id: relative("src/content/blog", file),
    data: postSchema.parse(frontmatter(readFileSync(file, "utf8"))),
  }),
);
const listedPaths = new Set([
  "/",
  ...publishedPosts(entries).map((post) => `/${slugFor(post)}`),
]);

export default defineConfig({
  site: site.url,
  output: "static",
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [
    mdx(),
    react(),
    sitemap({ filter: (page) => listedPaths.has(new URL(page).pathname) }),
  ],
  markdown: {
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" } },
  },
  vite: { plugins: [tailwind()] },
});
