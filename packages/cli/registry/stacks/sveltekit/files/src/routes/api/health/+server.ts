import { error, json } from '@sveltejs/kit';
import { listItems } from '#lib/server/items.ts';

export const GET: import('./$types').RequestHandler = async ({ url }) => {
	if (url.search) error(400, 'Invalid request.');
	return json({ status: 'ok', items: (await listItems()).length }, { status: 200 });
};
