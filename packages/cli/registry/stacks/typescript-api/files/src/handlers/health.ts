/**
 * Connects the health API group's decoded requests to the Health service.
 * This layer supplies handlers to the platform-free application.
 */

import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../api.ts";
import { Health } from "../services/health.ts";

export const HealthHandlers = HttpApiBuilder.group(
  Api,
  "Health",
  Effect.fn(function* (handlers) {
    const health = yield* Health;
    return handlers
      .handle("get", () => health.get)
      .handle("check", ({ payload }) => health.check(payload));
  }),
);
