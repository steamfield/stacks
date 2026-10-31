import { HttpApi } from "effect/http-api";
import { HealthGroup } from "./api/health.ts";

export const Api = HttpApi.make("Api")
  .add(HealthGroup)
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" });
