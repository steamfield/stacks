import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../api.ts";
import { Readiness } from "../services/readiness.ts";

export const ReadinessHandlers = HttpApiBuilder.group(
  Api,
  "Readiness",
  Effect.fn(function* (handlers) {
    const readiness = yield* Readiness;
    return handlers.handle("get", () => readiness.check);
  }),
);
