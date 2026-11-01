import { json } from '@sveltejs/kit';
import { isReady } from '#lib/server/db/index.ts';

// Readiness: 200 when Postgres answers, 503 otherwise. Never includes the error text; the hook
// keeps this 503 body and adds the request ID and no-store headers.
export const GET: import('./$types').RequestHandler = async () => {
	const ready = await isReady();
	return json({ status: ready ? 'ready' : 'unavailable' }, { status: ready ? 200 : 503 });
};
