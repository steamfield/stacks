/**
 * Creates the app's TanStack Query cache with the shared retry policy. Browser startup and
 * test rendering each request a fresh client.
 */

import { QueryClient } from "@tanstack/react-query";
import { isRetryable } from "./errors";

/** Retries only failures that can succeed on a second try, at most twice. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (failures, error) => failures < 2 && isRetryable(error) },
    },
  });
}
