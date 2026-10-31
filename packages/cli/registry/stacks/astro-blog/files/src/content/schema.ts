import { z } from "astro/zod";

export const postSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  date: z.coerce.date(),
  updated: z.coerce.date().optional(),
  author: z.string().trim().min(1),
  tags: z.array(z.string()).default([]),
  status: z.enum(["draft", "published", "unlisted"]).default("published"),
  cover: z.string().optional(),
  ogImage: z.string().optional(),
});
