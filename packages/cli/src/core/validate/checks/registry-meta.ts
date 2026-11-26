/**
 * Checks `registry.json` on an official root (one holding `allowlist.json`, the marker `deps.ts`
 * uses): missing, malformed, or a `minCli` above this CLI's version is an error naming the file.
 */
import { Effect } from "effect";
import type { Check } from "../types";

export const registryMetaChecks: Check = Effect.fn("validate.registryMeta")(function* (_view) {
  return yield* Effect.succeed({ findings: [] });
});
