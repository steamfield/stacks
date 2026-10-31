import { expect, test } from 'bun:test';
import { setupApiTest } from './setup';

const t = setupApiTest('isolationa');
test('file A sees only its own rows while file B runs in parallel', async () => {
  await t.db.insert(t.schema.items).values({ name: 'file-a' });
  const response = await t.app.request('/items');
  expect(await response.json()).toEqual({ items: [{ id: 1, name: 'file-a' }] });
});
