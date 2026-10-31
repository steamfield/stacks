export function apiError(status: number, requestId: string) {
	const code =
		status === 400
			? 'INVALID_INPUT'
			: status === 404
				? 'NOT_FOUND'
				: status === 405
					? 'METHOD_NOT_ALLOWED'
					: 'INTERNAL';
	const message =
		status === 400
			? 'Invalid request.'
			: status === 404
				? 'Resource not found.'
				: status === 405
					? 'Method not allowed.'
					: 'Internal server error.';
	return { error: { code, message, requestId } };
}
