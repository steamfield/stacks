import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type AuthEnv, protectRoutes } from '../src/middleware/auth';
import { createSigner, setupTestAuth } from './auth';

const auth = setupTestAuth();
const saved = { ...process.env };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
afterEach(() => {
  for (const key of ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'DEV_AUTH_USER_ID']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('the middleware, in process', () => {
  // The chain as app.ts mounts it, on a bare app with app.ts's error envelope.
  const app = new Hono<AuthEnv>()
    .use('*', protectRoutes())
    .get('/health', (c) => c.json({ status: 'ok' }))
    .get('/me', (c) => c.json({ id: c.get('userId') }));
  app.onError((error, c) =>
    error instanceof HTTPException
      ? c.json({ message: error.message }, error.status)
      : c.json({ message: 'Internal server error' }, 500),
  );
  const me = (headers: Record<string, string> = {}) => app.request('/me', { headers });
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  beforeAll(() => {
    globalThis.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        requested.push(input instanceof Request ? input.url : String(input));
        return realFetch(input, init);
      },
      { preconnect: realFetch.preconnect },
    );
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  test('a valid session token reaches the route with its user id', async () => {
    const response = await auth.as(app, 'user_valid', '/me');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'user_valid' });
  });
  test('no token is 401', async () => {
    const response = await me();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
  });
  test('a token signed by another key is 401', async () => {
    expect((await me(bearer(createSigner()('user_valid')))).status).toBe(401);
  });
  test('an expired token is 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = auth.signSessionToken('user_valid', {
      iat: now - 600,
      nbf: now - 600,
      exp: now - 300,
    });
    expect((await me(bearer(expired))).status).toBe(401);
  });
  test('without keys public paths answer and protected ones are 503, not 500', async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    expect((await app.request('/health')).status).toBe(200);
    const response = await me();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: 'Auth is not configured' });
  });
  test('the dev bypass covers only requests with no authorization header', async () => {
    delete process.env.CLERK_SECRET_KEY;
    process.env.DEV_AUTH_USER_ID = 'user_devbypass';
    expect(await (await me()).json()).toEqual({ id: 'user_devbypass' });
    process.env.CLERK_SECRET_KEY = 'sk_test_local';
    expect((await me(bearer(createSigner()('user_other')))).status).toBe(401);
  });
  test('the dev bypass fails closed beside a live key', async () => {
    process.env.DEV_AUTH_USER_ID = 'user_devbypass';
    process.env.CLERK_SECRET_KEY = 'sk_live_leaked';
    expect((await me()).status).toBe(500);
  });
  test('verification made no network request', () => {
    expect(requested).toEqual([]);
  });
});

describe('the real API, booted from src/index.ts', () => {
  // A child process, so this proves the wiring in app.ts, config.ts and index.ts
  // rather than a copy of it.
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() =>
          typeof address === 'object' && address ? resolve(address.port) : reject(address),
        );
      });
    });
  const boot = (port: number, env: Record<string, string> = {}) =>
    spawn(process.execPath, ['src/index.ts'], {
      env: {
        ...process.env,
        // Neither route touches the database, so this address is never connected.
        DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
        PORT_API: String(port),
        ...env,
      },
      stdio: 'ignore',
    });
  let port = 0;
  let api: ReturnType<typeof boot> | undefined;
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;

  beforeAll(async () => {
    port = await freePort();
    api = boot(port);
    for (let attempt = 0; attempt < 100; attempt++) {
      const up = await fetch(url('/health')).catch(() => undefined);
      if (up?.ok) return;
      await Bun.sleep(100);
    }
    throw new Error('The API did not answer /health within 10 s.');
  });
  afterAll(() => {
    api?.kill();
  });

  test('/health is public, /me needs a token, and a valid one is accepted', async () => {
    expect((await fetch(url('/health'))).status).toBe(200);
    expect((await fetch(url('/me'))).status).toBe(401);
    const response = await fetch(url('/me'), {
      headers: bearer(auth.signSessionToken('user_booted')),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'user_booted' });
  });
  test('the API refuses to boot with the dev bypass beside a live key', async () => {
    const child = boot(await freePort(), {
      DEV_AUTH_USER_ID: 'user_devbypass',
      CLERK_SECRET_KEY: 'sk_live_leaked',
    });
    const status = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    expect(status).not.toBe(0);
  });
});
