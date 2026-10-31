import { Schema } from "effect";

export const DoctorResult = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  platform: Schema.String,
  compiled: Schema.Boolean,
  configFile: Schema.String,
  dataDir: Schema.String,
  greeting: Schema.NullOr(Schema.String),
  configError: Schema.NullOr(Schema.String),
});
