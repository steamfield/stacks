import { fail, redirect } from '@sveltejs/kit';
import { APP_TITLE } from '$app/env/private';
import { parseItem } from '#lib/item-schema.ts';
import { addItem, listItems } from '#lib/server/items.ts';

export const load = (async () => ({
	title: APP_TITLE,
	items: await listItems()
})) satisfies import('./$types').PageServerLoad;

export const actions = {
	default: async ({ request }) => {
		const parsed = parseItem(await request.formData());
		if (!parsed.success) return fail(400, parsed.form);
		await addItem(parsed.item.name);
		redirect(303, '/');
	}
} satisfies import('./$types').Actions;
