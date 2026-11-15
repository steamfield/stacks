/**
 * Defines the package metadata schema used by the process entry and build script. Decoding
 * supplies the executable name and optional version without trusting raw JSON.
 */

import { Schema } from "effect";

export const PackageInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.optionalKey(Schema.String),
});
