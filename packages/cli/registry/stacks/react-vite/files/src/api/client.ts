import type { z } from "zod";
import type { Logger } from "../logging";
import { ApiError } from "./errors";

export type ApiClient = {
  /** GETs `path` under the base URL and returns the body decoded by `schema`, or rejects with ApiError. */
  get<T>(path: string, schema: z.ZodType<T>, init?: { signal?: AbortSignal }): Promise<T>;
};

/** The one place the app calls fetch. */
export function createApiClient(options: { baseUrl: string; logger: Logger }): ApiClient {
  const { baseUrl, logger } = options;

  async function send(path: string, signal: AbortSignal | undefined): Promise<Response> {
    try {
      return await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" }, signal });
    } catch (cause) {
      // A cancelled query isn't a failure; let TanStack Query see the abort.
      if (signal?.aborted) throw cause;
      logger.warn("api_unreachable", { path });
      throw new ApiError({ kind: "network", path }, { cause });
    }
  }

  return {
    async get(path, schema, init = {}) {
      const response = await send(path, init.signal);
      const { status } = response;
      const requestId = response.headers.get("x-request-id") ?? undefined;
      if (!response.ok) {
        logger.warn("api_error", { path, status, requestId });
        throw new ApiError({ kind: "http", path, status, requestId });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        logger.error("api_decode_failed", { path, status, requestId, reason: "json" });
        throw new ApiError({ kind: "decode", path, status, requestId }, { cause });
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        // The issue count only: issue messages can quote the response body.
        const issues = parsed.error.issues.length;
        logger.error("api_decode_failed", { path, status, requestId, reason: "schema", issues });
        throw new ApiError({ kind: "decode", path, status, requestId }, { cause: parsed.error });
      }
      logger.debug("api_ok", { path, status, requestId });
      return parsed.data;
    },
  };
}
