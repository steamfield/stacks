import { Redacted } from "effect";
import { afterAll, beforeAll, inject } from "vitest";
import { pgLayer } from "../../src/platform/database.ts";
import { cloneDatabase, cloneName, databaseUrl, dropDatabase } from "./databases.ts";

/**
 * This test file's own database, cloned from the run's migrated template. Call it at module
 * scope; read its fields inside tests, after beforeAll has created it. `sql` is a fresh pool
 * per use, named after the database, so a test can check its sessions are gone afterwards.
 */
export function testDatabase(label: string) {
  let name: string | undefined;

  beforeAll(async () => {
    const created = cloneName(inject("dbRun"), label);
    await cloneDatabase(inject("dbTemplate"), created);
    name = created;
  });

  afterAll(async () => {
    if (name) await dropDatabase(name);
  });

  const current = () => {
    if (!name) throw new Error("Read the test database inside a test.");
    return name;
  };
  return {
    get name() {
      return current();
    },
    get url() {
      return databaseUrl(current());
    },
    get sql() {
      return pgLayer(Redacted.make(databaseUrl(current())), current());
    },
  };
}
