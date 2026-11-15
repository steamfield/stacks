/**
 * Re-exports health boundary schemas for the contract package's public entry.
 * The server and site share these types through the contract without importing each other's source.
 */

export { CheckParams, CheckPayload, CheckQuery, HealthStatus, NoQuery } from "./health.ts";
