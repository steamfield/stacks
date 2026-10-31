import { z } from "zod";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown(),
    requestId: z.string(),
  }),
});

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ErrorType<_T> = ApiError;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`,
    options,
  );
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Parser errors can quote private response content.
    throw new ApiError(
      "INVALID_RESPONSE",
      `API returned invalid JSON (HTTP ${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    const parsed = errorEnvelope.safeParse(body);
    if (parsed.success) {
      const { code, message, requestId } = parsed.data.error;
      throw new ApiError(code, message, response.status, requestId);
    }
    throw new ApiError(
      "INVALID_RESPONSE",
      `API returned HTTP ${response.status}`,
      response.status,
    );
  }
  // Callers validate the success body with the schema generated from OpenAPI.
  return body as T;
}
