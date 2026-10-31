import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Database = ReturnType<typeof database>;

// Build per request from the typed binding (`context.get(cloudflareContext).env.DB`).
// Workers code never opens a filesystem SQLite file.
export function database(d1: D1Database) {
  return drizzle(d1, { schema });
}

// The `/readyz` response: ready means D1 answers and the migrated schema is
// present. Failures are logged with fixed fields only; the error itself may carry
// SQL or binding details.
export async function readiness(d1: D1Database): Promise<Response> {
  try {
    await database(d1).select({ id: schema.items.id }).from(schema.items).limit(1);
    return Response.json({ status: "ok" });
  } catch {
    console.error(JSON.stringify({ event: "database-not-ready" }));
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
