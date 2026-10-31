import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, inject } from "vitest";
import * as schema from "../../src/lib/server/db/schema";
import {
  cloneDatabase,
  cloneName,
  databaseUrl,
  dropDatabase,
} from "./databases";

/**
 * This test file's own database, cloned from the run's migrated template. Call it at module
 * scope; read `t.db` and `t.url` inside tests, after beforeAll has filled them.
 */
export function setupTestDatabase(label: string) {
  let name: string | undefined;
  let pool: Pool | undefined;
  let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

  beforeAll(async () => {
    name = cloneName(inject("dbRun"), label);
    await cloneDatabase(inject("dbTemplate"), name);
    pool = new Pool({ connectionString: databaseUrl(name) });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    if (name) await dropDatabase(name);
  });

  return {
    get db() {
      if (!db) throw new Error("Read t.db inside a test.");
      return db;
    },
    get url() {
      if (!name) throw new Error("Read t.url inside a test.");
      return databaseUrl(name);
    },
  };
}
