import "server-only";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDatabase(url: string) {
  // A short connect timeout, so a down database fails a request in seconds instead of hanging.
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 3000,
  });
  // An idle client losing its connection must not take the server down; log without details.
  pool.on("error", (error: Error & { code?: string }) => {
    console.error(
      JSON.stringify({
        event: "db.pool-error",
        code: error.code ?? error.name,
      }),
    );
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>["db"];

// One pool per server process, created on first use (never at import, so `next build` needs no
// database) and kept on globalThis so dev-server reloads reuse it.
const store: typeof globalThis & {
  database?: ReturnType<typeof createDatabase>;
} = globalThis;

export function database(): Database {
  if (!store.database) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    store.database = createDatabase(url);
  }
  return store.database.db;
}

export async function isReady(
  db?: Database,
  timeoutMs = 2000,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("readiness timed out")),
      timeoutMs,
    );
  });
  try {
    await Promise.race([(db ?? database()).execute(sql`select 1`), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
