import { expect, it } from 'vitest';
import {
	cloneDatabase,
	cloneName,
	createMigrated,
	databaseExists,
	dropDatabase,
	newRunId,
	templateName
} from './databases';

it("one run's teardown leaves another run's databases in place", async () => {
	const [first, second] = [newRunId(), newRunId()];
	const names = {
		firstTemplate: templateName(first),
		firstClone: cloneName(first, 'a'),
		secondTemplate: templateName(second),
		secondClone: cloneName(second, 'b')
	};
	try {
		await Promise.all([createMigrated(names.firstTemplate), createMigrated(names.secondTemplate)]);
		await cloneDatabase(names.firstTemplate, names.firstClone);
		await cloneDatabase(names.secondTemplate, names.secondClone);

		await dropDatabase(names.firstClone);
		await dropDatabase(names.firstTemplate);

		expect(await databaseExists(names.firstTemplate)).toBe(false);
		expect(await databaseExists(names.firstClone)).toBe(false);
		expect(await databaseExists(names.secondTemplate)).toBe(true);
		expect(await databaseExists(names.secondClone)).toBe(true);
	} finally {
		for (const name of Object.values(names)) await dropDatabase(name);
	}
});

it('a failed migration leaves no template behind', async () => {
	const template = templateName(newRunId());

	await expect(
		createMigrated(template, async () => {
			throw new Error('migration failed');
		})
	).rejects.toThrow('migration failed');

	expect(await databaseExists(template)).toBe(false);
});
