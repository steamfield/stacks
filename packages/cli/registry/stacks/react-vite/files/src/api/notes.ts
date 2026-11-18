/**
 * Defines note response schemas and query options for the list and detail pages. Query
 * functions pass cancellation signals to the shared API client and return decoded data.
 */

import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { ApiClient } from "./client";

export const Note = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type Note = z.infer<typeof Note>;

/** One page of notes. An API may send `nextCursor: null` or leave it out on the last page. */
export const NoteList = z.object({ items: z.array(Note), nextCursor: z.string().nullish() });
export type NoteList = z.infer<typeof NoteList>;

/** GET {apiUrl}/v1/notes, the list page's data. */
export const notesQuery = (api: ApiClient) =>
  queryOptions({
    queryKey: ["notes"],
    queryFn: ({ signal }) => api.get("/v1/notes", NoteList, { signal }),
  });

/** GET {apiUrl}/v1/notes/:id, the detail page's data. */
export const noteQuery = (api: ApiClient, id: string) =>
  queryOptions({
    queryKey: ["notes", id],
    queryFn: ({ signal }) => api.get(`/v1/notes/${encodeURIComponent(id)}`, Note, { signal }),
  });
