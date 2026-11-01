import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createDatabase, isReady } from '#lib/server/db/index.ts';
import { items } from '#lib/server/db/schema.ts';
import { itemsRepository } from '#lib/server/items-repository.ts';
import { setupTestDatabase } from './harness';

const t = setupTestDatabase('items');

it('adds an item and reads it back', async () => {
	const repository = itemsRepository(t.db);
	const name = `item ${crypto.randomUUID()}`;

	const result = await repository.add(name);

	expect(result).toMatchObject({ status: 'added', item: { name } });
	expect(await repository.list()).toContainEqual(
		result.status === 'added' ? result.item : undefined
	);
});

it('reports a duplicate name and writes nothing', async () => {
	const repository = itemsRepository(t.db);
	const name = `duplicate ${crypto.randomUUID()}`;
	await repository.add(name);

	expect(await repository.add(name)).toEqual({ status: 'duplicate' });
	expect(await t.db.select().from(items).where(eq(items.name, name))).toHaveLength(1);
});

it('leaves no row behind when a transaction throws after an insert', async () => {
	const name = `rollback ${crypto.randomUUID()}`;

	await expect(
		t.db.transaction(async (tx) => {
			await tx.insert(items).values({ name });
			throw new Error('abort');
		})
	).rejects.toThrow('abort');

	expect(await t.db.select().from(items).where(eq(items.name, name))).toEqual([]);
});

it('is ready on its database and unavailable on a closed port', async () => {
	const closed = createDatabase('postgres://app:app@127.0.0.1:1/app');
	try {
		expect(await isReady(t.db)).toBe(true);
		expect(await isReady(closed.db)).toBe(false);
	} finally {
		await closed.pool.end();
	}
});
