import { PgClient } from "@effect/sql-pg";
import type { Redacted } from "effect";

/**
 * A pooled Postgres client. It opens no connection until the first query, so the server starts
 * and /healthz answers while the database is down; the pool closes with the layer's scope.
 */
export function pgLayer(url: Redacted.Redacted, applicationName?: string) {
  return PgClient.layer({
    url,
    applicationName,
    minConnections: 0,
    connectTimeout: "3 seconds",
    acquireTimeout: "3 seconds",
  });
}
