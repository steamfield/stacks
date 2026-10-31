import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { ApiClient } from "./client";

export const Item = z.object({ id: z.string(), name: z.string(), description: z.string() });
export type Item = z.infer<typeof Item>;

const ItemList = z.object({ items: z.array(Item) });

/** GET {apiUrl}/items, the list page's data. */
export const itemsQuery = (api: ApiClient) =>
  queryOptions({
    queryKey: ["items"],
    queryFn: async ({ signal }) => (await api.get("/items", ItemList, { signal })).items,
  });

/** GET {apiUrl}/items/:id, the detail page's data. */
export const itemQuery = (api: ApiClient, id: string) =>
  queryOptions({
    queryKey: ["items", id],
    queryFn: ({ signal }) => api.get(`/items/${encodeURIComponent(id)}`, Item, { signal }),
  });
