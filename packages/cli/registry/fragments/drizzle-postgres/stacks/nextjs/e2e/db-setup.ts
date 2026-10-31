// Playwright's own database on db-test, never the dev database. The config names it once and
// stores the name in process.env, so workers that load the config again see the same name.
// Global setup creates and migrates it and seeds the rows the page tests expect; the returned
// function drops it when the run ends.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { items } from "../src/lib/server/db/schema";
import {
  cloneName,
  createMigrated,
  databaseUrl,
  dropDatabase,
  newRunId,
} from "../tests/db/databases";

export function e2eDatabase(): string {
  process.env.E2E_DATABASE ??= cloneName(newRunId(), "e2e");
  return process.env.E2E_DATABASE;
}

export default async function globalSetup() {
  const name = e2eDatabase();
  await createMigrated(name);
  const pool = new Pool({ connectionString: databaseUrl(name) });
  try {
    await drizzle(pool)
      .insert(items)
      .values([{ name: "Read the code" }, { name: "Run the checks" }]);
  } finally {
    await pool.end();
  }
  return async () => {
    await dropDatabase(name);
  };
}
