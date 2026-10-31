// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import AddItemForm from './AddItemForm.svelte';

it('shows the field error and preserves a failed value for editing', async () => {
	render(AddItemForm, {
		form: { name: 'Too long', errors: { name: 'Use at most 80 characters.' } }
	});
	const input = screen.getByRole('textbox', { name: 'Item name' });
	expect(input).toHaveValue('Too long');
	expect(input).toHaveAccessibleDescription('Use at most 80 characters.');
	expect(screen.getByRole('alert')).toHaveTextContent('Use at most 80 characters.');
	await userEvent.clear(input);
	await userEvent.type(input, 'A replacement');
	expect(input).toHaveValue('A replacement');
	expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled();
});

it('starts with an empty enabled form', () => {
	render(AddItemForm, { form: null });
	expect(screen.getByRole('textbox', { name: 'Item name' })).toHaveValue('');
	expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled();
});
