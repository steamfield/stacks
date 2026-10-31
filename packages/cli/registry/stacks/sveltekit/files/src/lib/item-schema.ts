import { z } from 'zod';

export const itemSchema = z.object({
	name: z.string().trim().min(1, 'Enter an item name.').max(80, 'Use at most 80 characters.')
});

export type ItemForm = { name: string; errors: { name?: string } };

export function parseItem(form: FormData) {
	const value = form.get('name');
	const name = typeof value === 'string' ? value : '';
	const result = itemSchema.safeParse({ name });
	if (!result.success) {
		return {
			success: false,
			form: { name, errors: { name: result.error.issues[0]?.message ?? 'Enter an item name.' } }
		} as const;
	}
	return { success: true, item: result.data } as const;
}
