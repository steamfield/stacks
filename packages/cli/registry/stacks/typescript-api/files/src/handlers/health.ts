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
