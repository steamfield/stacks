import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { BadInputResponse, UnavailableResponse } from "../errors.ts";
import { NoQuery } from "../schemas/index.ts";
import { ReadyStatus } from "../schemas/items.ts";

// Readiness sits beside /healthz, outside /v1. /healthz never touches the database.
export const ReadinessGroup = HttpApiGroup.make("Readiness").add(
  HttpApiEndpoint.get("get", "/readyz", {
    query: NoQuery,
    success: ReadyStatus,
    error: [BadInputResponse, UnavailableResponse],
  }),
);
