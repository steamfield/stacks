import { Schema } from "effect";

export const PackageInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.optionalKey(Schema.String),
});
