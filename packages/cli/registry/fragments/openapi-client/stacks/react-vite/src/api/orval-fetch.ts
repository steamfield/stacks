/**
 * Orval's mutator: sends every generated call through the app's API client, so generated hooks
 * share the base URL, logging and ApiError with the hand-written queries beside it. Generated
 * calls skip zod decoding; their types come from openapi.json instead.
 */

import { z } from "zod";
import type { ApiClient } from "./client";
import type { ApiError } from "./errors";

/** Orval reads this name: a generated hook's error is the client's ApiError. */
export type ErrorType<_Error> = ApiError;

/** A generated call's options. A page passes `{ request: { api } }` with useServices()'s client. */
export type GeneratedRequest = RequestInit & { api?: ApiClient };

/** Orval calls this with the operation's path (`/v1/notes`) and the fetch options it built. */
export async function orvalFetch<T>(url: string, init: GeneratedRequest = {}): Promise<T> {
  const { api, method = "GET", body, headers, signal } = init;
  if (!api) {
    throw new TypeError(`${method} ${url} needs the API client: pass { request: { api } }`);
  }
  if (body != null && typeof body !== "string") {
    // The client sends JSON only; Orval passes a JSON body as a string.
    throw new TypeError(`${method} ${url} has a non-JSON body, which the API client can't send`);
  }
  return api.request(url, z.custom<T>(), {
    method,
    body: body == null ? undefined : JSON.parse(body),
    headers: Object.fromEntries(new Headers(headers)),
    signal: signal ?? undefined,
  });
}
