// The HTTP contract, through Supertest on the real AppModule with configureApp
// applied: statuses, envelopes, headers and the request log. Extend the tables
// for every new endpoint.
import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ErrorCode, errorTable } from '../../src/common/errors.js';
import type { Note, NotePage } from '../../src/notes/dto/note.dto.js';
import { type TestAppOptions, testApp } from '../helpers/app.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const SAFE_ID = /^[\w=-]+$/;

let current: NestExpressApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function start(options: TestAppOptions = {}) {
  const ctx = await testApp(options);
  current = ctx.app;
  return { ...ctx, http: request(ctx.server) };
}

function expectEnvelope(res: Response, code: ErrorCode) {
  expect(res.status).toBe(errorTable[code].status);
  expect(res.headers['content-type']).toMatch(/^application\/json/);
  const body = res.body as {
    error: { code: string; message: string; requestId: string; issues?: unknown };
  };
  expect(Object.keys(body)).toEqual(['error']);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(errorTable[code].message);
  expect(body.error.requestId).toBe(res.headers['x-request-id']);
  return body.error;
}

describe('health and the OpenAPI document', () => {
  it('GET /healthz answers ok with a request id, logged at debug', async () => {
    const { http, requests } = await start();
    const res = await http.get('/healthz').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(SAFE_ID);
    await vi.waitFor(() =>
      expect(requests()).toMatchObject([{ level: 'debug', route: '/healthz', status: 200 }]),
    );
  });

  it('GET /openapi.json documents every route and the error envelope', async () => {
    const { http } = await start();
    const doc = (await http.get('/openapi.json').expect(200)).body as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths).sort()).toEqual(['/healthz', '/v1/notes', '/v1/notes/{id}']);
    expect(Object.keys(doc.paths['/v1/notes'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(doc.components.schemas).toHaveProperty('ErrorEnvelope');
    expect(doc.components.schemas).toHaveProperty('CreateNoteDto');
  });
});

describe('notes', () => {
  it('creates a note: 201, Location, and the logged request id', async () => {
    const { http, requests } = await start();
    const res = await http.post('/v1/notes').send({ title: 'First', body: 'Hello' }).expect(201);
    const note = res.body as Note;
    expect(note).toMatchObject({ title: 'First', body: 'Hello' });
    expect(res.headers.location).toBe(`/v1/notes/${note.id}`);
    await vi.waitFor(() =>
      expect(requests()).toEqual([
        expect.objectContaining({
          level: 'log',
          method: 'POST',
          route: '/v1/notes',
          status: 201,
          requestId: res.headers['x-request-id'],
        }),
      ]),
    );

    const fetched = await http.get(`/v1/notes/${note.id}`).expect(200);
    expect(fetched.body).toEqual(note);
  });

  it('defaults body to an empty string and trims the title', async () => {
    const { http } = await start();
    const res = await http.post('/v1/notes').send({ title: '  Spaced  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Spaced', body: '' });
  });

  it('pages the list with limit and nextCursor', async () => {
    const { http } = await start();
    for (const title of ['a', 'b', 'c']) {
      await http.post('/v1/notes').send({ title }).expect(201);
    }
    const first = (await http.get('/v1/notes?limit=2').expect(200)).body as NotePage;
    expect(first.items.map((note) => note.title)).toEqual(['a', 'b']);
    expect(first.nextCursor).toBe(first.items[1]?.id);
    const second = (
      await http.get(`/v1/notes?limit=2&cursor=${first.nextCursor ?? ''}`).expect(200)
    ).body as NotePage;
    expect(second.items.map((note) => note.title)).toEqual(['c']);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps a supplied safe request id and replaces an unsafe one', async () => {
    const { http } = await start();
    const kept = await http.get('/healthz').set('x-request-id', 'abc-123');
    expect(kept.headers['x-request-id']).toBe('abc-123');
    const replaced = await http.get('/healthz').set('x-request-id', 'evil" level=fatal');
    expect(replaced.headers['x-request-id']).toMatch(SAFE_ID);
    expect(replaced.headers['x-request-id']).not.toContain('evil');
  });
});

describe('errors', () => {
  it.each([
    ['missing title', { body: 'no title' }, 'title'],
    ['blank title', { title: '   ' }, 'title'],
    ['unknown field', { title: 'x', extra: true }, 'extra'],
    ['wrong type', { title: 42 }, 'title'],
  ])('POST /v1/notes with %s is the 400 envelope with issues', async (_, body, path) => {
    const { http } = await start();
    const res = await http.post('/v1/notes').send(body);
    const error = expectEnvelope(res, 'bad_request');
    expect(error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it.each([
    ['an unknown query key', '/v1/notes?sort=title'],
    ['a limit out of range', '/v1/notes?limit=0'],
    ['a malformed cursor', '/v1/notes?cursor=nope'],
    ['a malformed id', '/v1/notes/not-a-uuid'],
  ])('%s is the 400 envelope', async (_, path) => {
    const { http } = await start();
    expectEnvelope(await http.get(path), 'bad_request');
  });

  it('malformed JSON is the 400 envelope', async () => {
    const { http } = await start();
    const res = await http
      .post('/v1/notes')
      .set('content-type', 'application/json')
      .send('{not json');
    expectEnvelope(res, 'bad_request');
  });

  it('a body over the limit is the 413 envelope', async () => {
    const { http } = await start({ maxBodyBytes: 64 });
    const res = await http.post('/v1/notes').send({ title: 'x'.repeat(200) });
    expectEnvelope(res, 'payload_too_large');
  });

  it.each([
    ['an unknown path', 'get', '/nope'],
    ['a missing note', 'get', `/v1/notes/${MISSING_ID}`],
    ['a wrong method', 'delete', '/v1/notes'],
    ['an unversioned resource path', 'get', '/notes'],
  ] as const)('%s is the 404 envelope with one request record', async (_, method, path) => {
    const { http, requests } = await start();
    expectEnvelope(await http[method](path), 'not_found');
    await vi.waitFor(() => expect(requests()).toHaveLength(1));
    expect(requests()[0]).toMatchObject({ status: 404 });
  });

  it('a thrown defect is a generic 500; the log has its class, not its message', async () => {
    const { http, logs } = await start({
      notes: { list: () => Promise.reject(new TypeError('db password=hunter2')) },
    });
    const res = await http.get('/v1/notes');
    const error = expectEnvelope(res, 'internal');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    const logged = logs.records.find((record) => record.message === 'unhandled error');
    expect(logged).toMatchObject({
      level: 'error',
      errorClass: 'TypeError',
      requestId: error.requestId,
    });
    expect(JSON.stringify(logs.records)).not.toContain('hunter2');
  });
});
