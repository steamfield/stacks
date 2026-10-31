import { z } from "@hono/zod-openapi";

export const Note = z
  .object({
    id: z.uuid().openapi({ example: "0b8f6d4e-3c1a-4f7e-9a51-2d6c8e0f1b23" }),
    title: z.string().openapi({ example: "Ship the first endpoint" }),
    body: z.string().openapi({ example: "List, get and create, with tests." }),
    createdAt: z.iso.datetime().openapi({ example: "2026-01-01T00:00:00.000Z" }),
  })
  .openapi("Note");

export type Note = z.infer<typeof Note>;

export const NoteInput = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(10_000).default(""),
  })
  .openapi("NoteInput");

export type NoteInput = z.infer<typeof NoteInput>;

export const NoteParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

export const NoteListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export type NoteListQuery = z.infer<typeof NoteListQuery>;

export const NotePage = z
  .object({ items: z.array(Note), nextCursor: z.uuid().nullable() })
  .openapi("NotePage");

export type NotePage = z.infer<typeof NotePage>;
