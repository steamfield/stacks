import { beforeEach, expect, it } from 'vitest';
import { addItem, listItems, resetItemsForTest } from './items';

beforeEach(resetItemsForTest);

it('starts with two seed items and returns independent snapshots', async () => {
	const items = await listItems();
	expect(items.map((item) => item.name)).toEqual(['Read the code', 'Run the checks']);
	items.splice(0);
	expect(await listItems()).toHaveLength(2);
});

it('adds and reads an item without carrying state across tests', async () => {
	expect(await listItems()).toHaveLength(2);
	const added = await addItem('A new item');
	expect(added.id).toBeTruthy();
	expect(await listItems()).toContainEqual(added);
});
