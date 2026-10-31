export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function apiError(response: Pick<Response, 'status' | 'json'>, fallback: string) {
  let message = fallback;
  // A proxy may return HTML or an empty body instead of the API's envelope.
  const parsed: unknown = await response.json().catch(() => null);
  if (
    parsed &&
    typeof parsed === 'object' &&
    'message' in parsed &&
    typeof parsed.message === 'string'
  )
    message = parsed.message;
  return new ApiError(response.status, message);
}
export function actionableMessage(error: unknown) {
  return error instanceof ApiError && [400, 403, 404, 409].includes(error.status)
    ? error.message
    : null;
}
