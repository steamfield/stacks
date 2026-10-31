import { beforeEach, expect, it } from 'vitest';
import { isActionFailure } from '@sveltejs/kit';
import { APP_TITLE } from '$app/env/private';
import { addItem, listItems, resetItemsForTest } from '#lib/server/items.ts';
import { event } from '../../tests/helpers/event';
import { actions, load } from './+page.server.ts';

beforeEach(resetItemsForTest);

it('loads live server data and the configured title', async () => {
	await addItem('From the service');
	const result = await load();
	expect(result.title).toBe(APP_TITLE);
	expect(result.items.map((item) => item.name)).toContain('From the service');
});

it('returns a field failure and writes nothing for invalid input', async () => {
	const body = new FormData();
	body.set('name', '  ');
	const result = await actions.default(
		event(new Request('http://localhost/', { method: 'POST', body }))
	);
	expect(isActionFailure(result)).toBe(true);
	expect(result).toMatchObject({
		status: 400,
		data: { name: '  ', errors: { name: 'Enter an item name.' } }
	});
	expect(await listItems()).toHaveLength(2);
});

it('adds valid input through the real action', async () => {
	const body = new FormData();
	body.set('name', '  From the action  ');
	await expect(
		actions.default(event(new Request('http://localhost/', { method: 'POST', body })))
	).rejects.toMatchObject({ status: 303, location: '/' });
	expect((await listItems()).map((item) => item.name)).toContain('From the action');
});
