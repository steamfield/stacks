/**
 * Exposes the shared API declaration, errors and schemas to the server and site.
 * Workspace consumers import this public entry so application code stays behind its own boundary.
 */

export { Api } from "./src/api.ts";
export * from "./src/errors.ts";
export * from "./src/schemas/index.ts";
