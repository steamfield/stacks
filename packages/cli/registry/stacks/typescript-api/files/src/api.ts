/**
 * Combines resource groups into the HTTP API declaration and rejects excess query fields.
 * Handlers and OpenAPI generation share this contract.
 */

import { HttpApi } from "effect/http-api";
import { HealthGroup } from "./api/health.ts";

export const Api = HttpApi.make("Api")
  .add(HealthGroup)
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" });
