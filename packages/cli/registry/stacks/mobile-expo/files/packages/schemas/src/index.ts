import { z } from 'zod';

export const HealthResponse = z
  .object({ status: z.literal('ok'), uptime: z.number().nonnegative() })
  .meta({ id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponse>;
export const ReadyResponse = z.object({ status: z.literal('ready') }).meta({ id: 'ReadyResponse' });
export type ReadyResponse = z.infer<typeof ReadyResponse>;
export const ErrorResponse = z.object({ message: z.string() }).meta({ id: 'ErrorResponse' });
export const ItemsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });
export const Item = z.object({ id: z.number().int(), name: z.string() }).meta({ id: 'Item' });
export const ItemsResponse = z.object({ items: z.array(Item) }).meta({ id: 'ItemsResponse' });
