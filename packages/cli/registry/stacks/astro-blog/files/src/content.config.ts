import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { postSchema } from "./content/schema";
import { slugFor } from "./lib/posts";

export const collections = {
  blog: defineCollection({
    loader: glob({
      pattern: "**/*.{md,mdx}",
      base: "./src/content/blog",
      generateId: ({ entry }) => slugFor({ id: entry }),
    }),
    schema: postSchema,
  }),
};
