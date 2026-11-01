import { asc } from 'drizzle-orm';
import { type Database, database } from './db/index.ts';
import { items } from './db/schema.ts';

export type Item = { id: string; name: string };
export type AddResult = { status: 'added'; item: Item } | { status: 'duplicate' };

const UNIQUE_VIOLATION = '23505';

// Drizzle wraps driver errors, so the Postgres code can sit on a cause.
function isUniqueViolation(error: unknown): boolean {
	for (let current = error; current instanceof Error; current = current.cause)
		if ((current as Error & { code?: string }).code === UNIQUE_VIOLATION) return true;
	return false;
}

const columns = { id: items.id, name: items.name };
const toItem = (row: { id: number; name: string }): Item => ({
	id: String(row.id),
	name: row.name
});

export function itemsRepository(db: Database) {
	return {
		async list(): Promise<Item[]> {
			const rows = await db.select(columns).from(items).orderBy(asc(items.id));
			return rows.map(toItem);
		},
		async add(name: string): Promise<AddResult> {
			try {
				const [row] = await db.insert(items).values({ name }).returning(columns);
				if (!row) throw new Error('Insert returned no row.');
				return { status: 'added', item: toItem(row) };
			} catch (error) {
				if (isUniqueViolation(error)) return { status: 'duplicate' };
				throw error;
			}
		}
	};
}

/** The repository on the process's shared pool, created on first use. */
export function defaultItemsRepository() {
	return itemsRepository(database());
}
