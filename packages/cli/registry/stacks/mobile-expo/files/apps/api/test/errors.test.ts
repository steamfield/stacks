import { beforeAll, expect, spyOn, test } from 'bun:test';
import { createApp } from '../src/app';
import { setupApiTest } from './setup';

const t = setupApiTest('errors');
const secret = 'secret-fixture-token';
beforeAll(() => {
  t.app.get('/__unexpected', () => {
    throw new Error(secret);
  });
  t.app.get('/__resource/:id', (c) => c.json({ id: c.req.param('id') }));
});
test('unexpected failures are bare JSON with correlated logs and no request secrets', async () => {
  const errorLog = spyOn(console, 'error').mockImplementation(() => {});
  const requestLog = spyOn(console, 'info').mockImplementation(() => {});
  try {
    const response = await t.app.request('/__unexpected', {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'Internal server error' });
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(errorLog.mock.calls).toHaveLength(1);
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
      level: 'error',
      requestId,
      error: {
        class: 'Error',
        stack: expect.arrayContaining([expect.stringContaining('errors.test.ts')]),
      },
    });
    expect(JSON.stringify([...errorLog.mock.calls, ...requestLog.mock.calls])).not.toContain(
      secret,
    );
  } finally {
    errorLog.mockRestore();
    requestLog.mockRestore();
  }
});
test('request logs use route patterns and an unmatched marker instead of secret path segments', async () => {
  const log = spyOn(console, 'info').mockImplementation(() => {});
  try {
    expect((await t.app.request(`/__resource/${secret}`)).status).toBe(200);
    expect((await t.app.request(`/missing/${secret}`)).status).toBe(404);
    expect(log.mock.calls.map((call) => JSON.parse(String(call[0])).path)).toEqual([
      '/__resource/:id',
      '<unmatched>',
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  } finally {
    log.mockRestore();
  }
});
test('readiness returns a 503 envelope when the database is unavailable', async () => {
  const app = createApp('postgres://app:app@127.0.0.1:1/unavailable');
  const response = await app.request('/health/ready');
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ message: 'Database unavailable' });
});
