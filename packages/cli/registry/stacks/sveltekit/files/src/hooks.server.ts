import { json } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { apiError } from '#lib/server/errors.ts';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	const started = performance.now();
	let response = await resolve(event);
	const readinessUnavailable = event.url.pathname === '/api/ready' && response.status === 503;
	if (event.url.pathname.startsWith('/api/') && response.status >= 400 && !readinessUnavailable) {
		const headers = new Headers(response.headers);
		for (const header of ['content-type', 'content-length', 'content-encoding', 'etag'])
			headers.delete(header);
		response = json(apiError(response.status, event.locals.requestId), {
			status: response.status,
			headers
		});
	}
	response.headers.set('x-request-id', event.locals.requestId);
	response.headers.set('cache-control', 'no-store');
	console.info(
		JSON.stringify({
			event: 'request',
			requestId: event.locals.requestId,
			method: event.request.method,
			route: event.route.id ?? '<unmatched>',
			status: response.status,
			durationMs: Math.round(performance.now() - started)
		})
	);
	return response;
};

export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind === 'unknown') {
		console.error(
			JSON.stringify({
				event: 'unexpected-error',
				requestId: event.locals.requestId,
				type: error instanceof Error ? error.name : typeof error
			})
		);
		return { message: 'Internal server error.' };
	}
};
