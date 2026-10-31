import { afterAll, beforeAll } from 'bun:test';
import { SQL } from 'bun';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { closeDb, db } from '../src/db';
import * as schema from '../src/db/schema';

const baseUrl = process.env.DATABASE_URL;
const runId = crypto.randomUUID().replaceAll('-', '');
const templateName = `test_template_${runId}`;
const owned = new Set<string>();
let template: Promise<void> | undefined;
let templateMigrations = 0;

function databaseUrl(name: string) {
  if (!baseUrl) throw new Error('DATABASE_URL is not set. Run bun run db:up and load .env.');
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
async function admin<T>(action: (sql: SQL) => Promise<T>) {
  const sql = new SQL(databaseUrl('postgres'), { max: 1 });
  try {
    return await action(sql);
  } finally {
    await sql.close();
  }
}
async function drop(name: string) {
  if (!owned.has(name)) throw new Error('Refusing to drop a database this run does not own');
  await closeDb(databaseUrl(name));
  await admin(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
  owned.delete(name);
}
async function prepareTemplate() {
  await admin(async (sql) => {
    await sql`select pg_advisory_lock(hashtext(${templateName}))`;
    try {
      await sql.unsafe(`CREATE DATABASE "${templateName}"`);
      owned.add(templateName);
      try {
        await migrate(db(databaseUrl(templateName)).db, { migrationsFolder: './drizzle' });
        templateMigrations++;
      } finally {
        await closeDb(databaseUrl(templateName));
      }
    } finally {
      await sql`select pg_advisory_unlock(hashtext(${templateName}))`;
    }
  });
}
export async function createTestDatabase(label: string) {
  template ??= prepareTemplate();
  await template;
  const name = `test_${label.replace(/[^a-z0-9]/gi, '').slice(0, 12)}_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin(async (sql) => {
    await sql.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  });
  owned.add(name);
  let dropped = false;
  return {
    name,
    url: databaseUrl(name),
    async drop() {
      if (!dropped) {
        await drop(name);
        dropped = true;
      }
    },
  };
}

// A failed fixture setup has the same ownership and cleanup as a test file.
export async function withTestDatabase<T>(
  label: string,
  action: (database: Awaited<ReturnType<typeof createTestDatabase>>) => Promise<T>,
) {
  const database = await createTestDatabase(label);
  try {
    return await action(database);
  } finally {
    await database.drop();
  }
}
export function setupApiTest(label: string) {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof import('../src/app')['createApp']>;
  beforeAll(async () => {
    database = await createTestDatabase(label);
    try {
      process.env.DATABASE_URL = database.url;
      const { createApp } = await import('../src/app');
      app = createApp(database.url);
    } catch (error) {
      await database.drop();
      throw error;
    }
  });
  afterAll(async () => {
    if (database) await database.drop();
  });
  return {
    get app() {
      return app;
    },
    get database() {
      return database;
    },
    get db() {
      return db(database.url).db;
    },
    get sql() {
      return db(database.url).sql;
    },
    schema,
  };
}
export function migrationCount() {
  return templateMigrations;
}

export async function cleanupDatabases() {
  // Exact ownership only. Never discover or delete another run's leftovers.
  for (const name of [...owned].filter((value) => value !== templateName)) await drop(name);
  if (owned.has(templateName)) await drop(templateName);
}
