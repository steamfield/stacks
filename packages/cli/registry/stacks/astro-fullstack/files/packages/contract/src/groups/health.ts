import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { apiErrors } from "../errors.ts";
import { CheckParams, CheckPayload, CheckQuery, HealthStatus, NoQuery } from "../schemas/index.ts";

export const HealthGroup = HttpApiGroup.make("Health").add(
  HttpApiEndpoint.get("get", "/healthz", {
    query: NoQuery,
    success: HealthStatus,
    error: apiErrors,
  }),
  HttpApiEndpoint.post("check", "/v1/health-checks/:checkId", {
    params: CheckParams,
    query: CheckQuery,
    payload: CheckPayload,
    success: HealthStatus,
    error: apiErrors,
  }),
);
