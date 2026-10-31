import { expect, test } from '@playwright/test';
import { z } from 'zod';

test('loads server data, validates, enhances a write and keeps it after reload', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/');
	await expect(page).toHaveTitle('Items');
	const list = page.getByRole('list', { name: 'Items' });
	await expect(list.getByText('Read the code', { exact: true })).toBeVisible();
	await expect(list.getByText('Run the checks', { exact: true })).toBeVisible();
	const before = await list.getByRole('listitem').count();
	await page.getByRole('button', { name: 'Add item' }).click();
	await expect(page.getByRole('alert')).toHaveText('Enter an item name.');
	await expect(list.getByRole('listitem')).toHaveCount(before);
	const name = `Enhanced ${crypto.randomUUID()}`;
	await page.getByRole('textbox', { name: 'Item name' }).fill(`  ${name}  `);
	// A document navigation would hide broken enhancement behind the plain POST fallback.
	const navigations: string[] = [];
	page.on('request', (request) => {
		if (request.isNavigationRequest() && request.frame() === page.mainFrame())
			navigations.push(request.url());
	});
	await page.getByRole('button', { name: 'Add item' }).click();
	await expect(list.getByText(name, { exact: true })).toBeVisible();
	await expect(list.getByRole('listitem')).toHaveCount(before + 1);
	expect(navigations).toEqual([]);
	await page.reload();
	await expect(list.getByText(name, { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});

test('validates and writes with JavaScript disabled', async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		baseURL: test.info().project.use.baseURL
	});
	try {
		const page = await context.newPage();
		await page.goto('/');
		const before = await page.getByRole('listitem').count();
		await page.getByRole('button', { name: 'Add item' }).click();
		await expect(page.getByRole('alert')).toHaveText('Enter an item name.');
		await expect(page.getByRole('listitem')).toHaveCount(before);
		const name = `Plain ${crypto.randomUUID()}`;
		await page.getByRole('textbox', { name: 'Item name' }).fill(name);
		await page.getByRole('button', { name: 'Add item' }).click();
		await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
		await page.reload();
		await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
	} finally {
		await context.close();
	}
});

test('health reports live state without caching', async ({ request }) => {
	const response = await request.get('/api/health');
	expect(response.status()).toBe(200);
	const body: unknown = await response.json();
	expect(
		z.object({ status: z.literal('ok'), items: z.number().int().min(2) }).parse(body).status
	).toBe('ok');
	expect(response.headers()['cache-control']).toContain('no-store');
	expect(response.headers()['x-request-id']).toMatch(/^[\w-]+$/);
});

test('API errors use one safe envelope', async ({ request }) => {
	for (const [path, status, code] of [
		['/api/health?invalid=true', 400, 'INVALID_INPUT'],
		['/api/missing', 404, 'NOT_FOUND']
	] as const) {
		const response = await request.get(path);
		expect(response.status()).toBe(status);
		const body: unknown = await response.json();
		const parsed = z
			.object({
				error: z.object({ code: z.literal(code), message: z.string(), requestId: z.string() })
			})
			.parse(body);
		expect(parsed.error.requestId).toBe(response.headers()['x-request-id']);
	}
});

test('unknown pages render the safe error page with a 404', async ({ page }) => {
	const response = await page.goto('/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
	await expect(page.getByText("We couldn't load this page.")).toBeVisible();
	await page.getByRole('link', { name: 'Back to items' }).click();
	await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
});

test('rejects cross-origin form posts without a write', async ({ request }) => {
	const name = `Forbidden ${crypto.randomUUID()}`;
	const response = await request.post('/', {
		headers: { origin: 'https://untrusted.invalid' },
		form: { name }
	});
	expect(response.status()).toBe(403);
	expect(await (await request.get('/')).text()).not.toContain(name);
});
