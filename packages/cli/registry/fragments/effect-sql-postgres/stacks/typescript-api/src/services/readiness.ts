/**
 * Defines the readiness service and its in-memory implementation. The API handler uses it to check the data store.
 */

import { Context, Effect, Layer } from "effect";
import type { Unavailable } from "../errors.ts";

/** Whether the data store answers. The Postgres layer is ReadinessSql in readiness-sql.ts. */
export class Readiness extends Context.Service<
  Readiness,
  { readonly check: Effect.Effect<{ readonly status: "ready" }, Unavailable> }
>()("api/Readiness") {
  /** The in-memory store is always ready. */
  static readonly layerMemory = Layer.succeed(
    this,
    this.of({ check: Effect.succeed({ status: "ready" }) }),
  );
}
