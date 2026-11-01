import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { dev } from '$app/env';
import { DATABASE_URL, PORT_DB } from '$app/env/private';
import * as schema from './schema.ts';

export function createDatabase(url: string) {
	// A short connect timeout, so a down database fails a request in seconds instead of hanging.
	const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
	// An idle client losing its connection must not take the server down; log without details.
	pool.on('error', (error: Error & { code?: string }) => {
		console.error(JSON.stringify({ event: 'db.pool-error', code: error.code ?? error.name }));
	});
	return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>['db'];

// One pool per server process, created on first use (never at import, so the build needs no
// database) and kept on globalThis so dev-server reloads reuse it.
const store: typeof globalThis & { database?: ReturnType<typeof createDatabase> } = globalThis;

// DATABASE_URL, or in development the Compose dev database on PORT_DB, as drizzle.config.ts
// builds it, so .env needs no URL that could disagree with the port.
function databaseUrl(): string {
	if (DATABASE_URL) return DATABASE_URL;
	if (!dev) throw new Error('DATABASE_URL is not set.');
	return `postgres://app:app@localhost:${PORT_DB || '5432'}/app`;
}

export function database(): Database {
	store.database ??= createDatabase(databaseUrl());
	return store.database.db;
}

export async function isReady(db?: Database, timeoutMs = 2000): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('readiness timed out')), timeoutMs);
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
