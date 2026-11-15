/**
 * Defines the doctor result schema shared by the core diagnostic and its contract tests. It
 * includes runtime facts, resolved paths and nullable configuration results.
 */

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
