import { expect, it } from 'vitest';
import { parseItem } from './item-schema';

it('trims a valid item name', () => {
	const form = new FormData();
	form.set('name', '  Read a book  ');
	expect(parseItem(form)).toEqual({ success: true, item: { name: 'Read a book' } });
});

it.each([
	['', 'Enter an item name.'],
	['   ', 'Enter an item name.'],
	['x'.repeat(81), 'Use at most 80 characters.']
])('rejects %j with the field error', (name, message) => {
	const form = new FormData();
	form.set('name', name);
	expect(parseItem(form)).toEqual({ success: false, form: { name, errors: { name: message } } });
});

it('rejects a file or a missing name', () => {
	for (const value of [undefined, new File(['secret'], 'name.txt')]) {
		const form = new FormData();
		if (value) form.set('name', value);
		expect(parseItem(form)).toMatchObject({
			success: false,
			form: { errors: { name: 'Enter an item name.' } }
		});
	}
});
