/**
 * Combines resource groups into the shared HTTP API declaration and rejects excess query fields.
 * The API server, browser client and OpenAPI generation all depend on this contract.
 */

import { HttpApi } from "effect/http-api";
import { HealthGroup } from "./groups/health.ts";

export const Api = HttpApi.make("Api")
  .add(HealthGroup)
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" });
