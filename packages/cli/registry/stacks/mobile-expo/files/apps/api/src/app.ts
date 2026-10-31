import { OpenAPIHono } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { routePath } from 'hono/route';
import type { AppEnv } from './env';
import { routes } from './routes';
import { validationHook } from './validation';

export function createApp(databaseUrl: string) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('*', cors());
  app.use('*', async (c, next) => {
    c.set('databaseUrl', databaseUrl);
    c.set('requestId', crypto.randomUUID());
    c.header('x-request-id', c.get('requestId'));
    const started = performance.now();
    await next();
    const matchedPath = routePath(c, -1);
    console.info(
      JSON.stringify({
        level: 'info',
        time: new Date().toISOString(),
        requestId: c.get('requestId'),
        method: c.req.method,
        path:
          matchedPath && matchedPath !== '*' && matchedPath !== '/*' ? matchedPath : '<unmatched>',
        status: c.res.status,
        durationMs: performance.now() - started,
      }),
    );
  });
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ message: error.message }, error.status);
    console.error(
      JSON.stringify({
        level: 'error',
        time: new Date().toISOString(),
        requestId: c.get('requestId'),
        error: {
          class: error.constructor.name,
          stack: (error.stack ?? '')
            .split('\n')
            .filter((line) => /^\s+at /.test(line))
            .map((line) => line.trim()),
        },
      }),
    );
    return c.json({ message: 'Internal server error' }, 500);
  });
  app.notFound((c) => c.json({ message: 'Not found' }, 404));
  app.route('/', routes);
  app.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'Mobile API', version: '0.1' } });
  app.get('/docs', apiReference({ url: '/openapi.json' }));
  return app;
}
