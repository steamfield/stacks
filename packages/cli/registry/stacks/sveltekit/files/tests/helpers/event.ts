import type { RequestEvent } from '@sveltejs/kit';

// Direct action and hook calls use one partial event; HTTP behavior is covered by Playwright.
export function event(request: Request) {
	return { request, url: new URL(request.url), locals: {}, route: { id: '/' } } as RequestEvent<
		Record<string, never>,
		'/'
	>;
}
