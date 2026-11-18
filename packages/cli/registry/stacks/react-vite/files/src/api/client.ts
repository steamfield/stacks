/**
 * Implements the app's fetch boundary with schema decoding and typed API failures. Resource
 * query modules use it to receive validated data and pass cancellation through unchanged.
 */

import type { z } from "zod";
import type { Logger } from "../logging";
import { ApiError } from "./errors";

/**
 * What a request carries besides its path. `body` is sent as JSON and needs a method other than
 * GET or HEAD. A header here replaces the default of the same name.
 */
export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
};

export type ApiClient = {
  /**
   * Sends `path` under the base URL and returns the body decoded by `schema`, or rejects with
   * ApiError. A 204 has no body: `schema` decodes `undefined` (pass `z.undefined()`).
   */
  request<T>(path: string, schema: z.ZodType<T>, init?: RequestOptions): Promise<T>;
  /** `request` with GET. */
  get<T>(path: string, schema: z.ZodType<T>, init?: { signal?: AbortSignal }): Promise<T>;
};

/** The one place the app calls fetch. */
export function createApiClient(options: { baseUrl: string; logger: Logger }): ApiClient {
  const { baseUrl, logger } = options;

  async function send(path: string, init: RequestOptions): Promise<Response> {
    const { method = "GET", body, headers = {}, signal } = init;
    if (body !== undefined && ["GET", "HEAD"].includes(method.toUpperCase())) {
      // fetch would throw this too, and the catch below would report it as a network failure.
      throw new TypeError(`${method} ${path} can't send a body; pass a method such as POST`);
    }
    const sent = new Headers({ accept: "application/json" });
    if (body !== undefined) sent.set("content-type", "application/json");
    // set() matches names case-insensitively, so a caller's Accept replaces the default.
    for (const [name, value] of Object.entries(headers)) sent.set(name, value);
    try {
      return await fetch(`${baseUrl}${path}`, {
        method,
        headers: sent,
        body: body === undefined ? null : JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (cause) {
      // A cancelled query isn't a failure; let TanStack Query see the abort.
      if (signal?.aborted) throw cause;
      logger.warn("api_unreachable", { path });
      throw new ApiError({ kind: "network", path }, { cause });
    }
  }

  async function readJson(response: Response, path: string, requestId?: string) {
    if (response.status === 204) return undefined;
    try {
      return (await response.json()) as unknown;
    } catch (cause) {
      const { status } = response;
      logger.error("api_decode_failed", { path, status, requestId, reason: "json" });
      throw new ApiError({ kind: "decode", path, status, requestId }, { cause });
    }
  }

  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestOptions = {}) {
    const response = await send(path, init);
    const { status } = response;
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      // The status and request id only: an error body can echo what the user sent.
      logger.warn("api_error", { path, status, requestId });
      throw new ApiError({ kind: "http", path, status, requestId });
    }
    const body = await readJson(response, path, requestId);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // The issue count only: issue messages can quote the response body.
      const issues = parsed.error.issues.length;
      logger.error("api_decode_failed", { path, status, requestId, reason: "schema", issues });
      throw new ApiError({ kind: "decode", path, status, requestId }, { cause: parsed.error });
    }
    logger.debug("api_ok", { path, status, requestId });
    return parsed.data;
  }

  return {
    request,
    get: (path, schema, init = {}) => request(path, schema, { signal: init.signal }),
  };
}
