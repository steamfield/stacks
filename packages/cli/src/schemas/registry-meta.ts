/** Defines `registry.json`, the registry-level metadata `build:index` and `validate` read. */
import { Schema } from "effect";

/**
 * `minCli` is the oldest CLI that can read the registry; `build:index` copies it into the index
 * header. Decode it strictly (`onExcessProperty: "error"`).
 */
export const RegistryMeta = Schema.Struct({
  formatVersion: Schema.Literal(1),
  minCli: Schema.String,
});
export type RegistryMeta = typeof RegistryMeta.Type;
