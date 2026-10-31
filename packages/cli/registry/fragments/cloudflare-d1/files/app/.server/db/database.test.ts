import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, expect, test } from "vitest";
import { database, readiness } from "./index";
import { items } from "./schema";

// Storage is isolated per test file, so this file migrates its own local D1
// database from the checked-in SQL, the same files Wrangler applies.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

test("the checked-in migrations create the schema", async () => {
  const response = await readiness(env.DB);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("applying the migrations again changes nothing", async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const applied = await env.DB.prepare("select count(*) as count from d1_migrations").first();
  expect(applied).toEqual({ count: env.TEST_MIGRATIONS.length });
});

test("rows round-trip through Drizzle's D1 driver", async () => {
  const db = database(env.DB);
  const [created] = await db.insert(items).values({ name: "round-trip" }).returning();
  expect(created).toMatchObject({ name: "round-trip" });
  expect(created?.createdAt).toBeInstanceOf(Date);
  const found = await db.select().from(items).where(eq(items.name, "round-trip"));
  expect(found).toEqual([created]);
});

test("constraint failures reject instead of passing silently", async () => {
  const db = database(env.DB);
  await db.insert(items).values({ name: "unique" });
  await expect(db.insert(items).values({ name: "unique" })).rejects.toThrow();
});

test("a missing schema is reported as unavailable", async () => {
  await env.DB.exec("ALTER TABLE items RENAME TO items_hidden");
  try {
    const response = await readiness(env.DB);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  } finally {
    await env.DB.exec("ALTER TABLE items_hidden RENAME TO items");
  }
});
