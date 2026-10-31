type Item = { id: string; name: string };
const store: typeof globalThis & { svelteItems?: Item[] } = globalThis;

function items() {
	store.svelteItems ??= [
		{ id: 'first', name: 'Read the code' },
		{ id: 'second', name: 'Run the checks' }
	];
	return store.svelteItems;
}

export async function listItems() {
	return items().map((item) => ({ ...item }));
}

export async function addItem(name: string) {
	const item = { id: crypto.randomUUID(), name };
	items().push(item);
	return { ...item };
}

export function resetItemsForTest() {
	if (process.env.NODE_ENV !== 'test') throw new Error('Item reset is test-only.');
	store.svelteItems = undefined;
}
