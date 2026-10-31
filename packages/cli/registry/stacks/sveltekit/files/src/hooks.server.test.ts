import { expect, it } from 'vitest';
import { event } from '../tests/helpers/event';
import { handle, handleError } from './hooks.server.ts';

it('keeps unexpected error details out of the public error', async () => {
	const request = event(new Request('http://localhost/'));
	request.locals.requestId = 'test-request';
	expect(
		await handleError({ kind: 'unknown', error: new Error('private credentials'), event: request })
	).toEqual({ message: 'Internal server error.' });
});

it('turns a failed API response into the safe envelope', async () => {
	const request = event(new Request('http://localhost/api/missing'));
	const response = await handle({
		event: request,
		resolve: async () => new Response('private error', { status: 500 })
	});
	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({
		error: {
			code: 'INTERNAL',
			message: 'Internal server error.',
			requestId: response.headers.get('x-request-id')
		}
	});
	expect(response.headers.get('cache-control')).toBe('no-store');
});

it('preserves the database readiness response and request headers', async () => {
	const response = await handle({
		event: event(new Request('http://localhost/api/ready')),
		resolve: async () => Response.json({ status: 'unavailable' }, { status: 503 })
	});
	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({ status: 'unavailable' });
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('x-request-id')).toMatch(/^[\w-]+$/);
});
