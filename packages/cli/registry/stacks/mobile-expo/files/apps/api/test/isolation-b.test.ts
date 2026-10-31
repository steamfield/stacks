import { expect, test } from 'bun:test';
import { setupApiTest } from './setup';

const t = setupApiTest('isolationb');
test('file B sees only its own rows while file A runs in parallel', async () => {
  await t.db.insert(t.schema.items).values({ name: 'file-b' });
  const response = await t.app.request('/items');
  expect(await response.json()).toEqual({ items: [{ id: 1, name: 'file-b' }] });
});
