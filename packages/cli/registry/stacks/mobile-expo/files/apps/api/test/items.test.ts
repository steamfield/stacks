import { expect, test } from 'bun:test';
import { setupApiTest } from './setup';

const t = setupApiTest('items');
test('lists ordered database rows and respects the validated limit', async () => {
  await t.db.insert(t.schema.items).values([{ name: 'First' }, { name: 'Second' }]);
  const response = await t.app.request('/items?limit=1');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [{ id: 1, name: 'First' }] });
});
