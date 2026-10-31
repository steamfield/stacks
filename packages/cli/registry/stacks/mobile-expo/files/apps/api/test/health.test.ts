import { expect, test } from 'bun:test';
import { setupApiTest } from './setup';

const t = setupApiTest('health');
test('reports process health and real database readiness', async () => {
  expect(await (await t.app.request('/health')).json()).toMatchObject({ status: 'ok' });
  expect(await (await t.app.request('/health/ready')).json()).toEqual({ status: 'ready' });
});
test('preserves the JSON error envelope for missing and invalid routes', async () => {
  const missing = await t.app.request('/missing');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ message: 'Not found' });
  const invalid = await t.app.request('/items?limit=invalid');
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ message: expect.stringContaining('limit') });
});
test('serves the OpenAPI resource and Scalar reference', async () => {
  const specification = await (await t.app.request('/openapi.json')).json();
  expect(specification.paths['/items']).toBeDefined();
  expect(await (await t.app.request('/docs')).text()).toContain('/openapi.json');
});
