/**
 * Re-exports the health boundary schemas through one entry point.
 * API declarations and services share these types without depending on the transport.
 */

export { CheckParams, CheckPayload, CheckQuery, HealthStatus, NoQuery } from "./health.ts";
