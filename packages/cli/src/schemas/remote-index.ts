/** Defines the remote index cache status reported by `doctor`. */
import { Schema } from "effect";

export const RemoteStatus = Schema.Struct({
  url: Schema.NullOr(Schema.String),
  isDefaultUrl: Schema.Boolean,
  offline: Schema.Boolean,
  cachedAt: Schema.NullOr(Schema.String),
  lastAttempt: Schema.NullOr(Schema.String),
  lastOutcome: Schema.NullOr(
    Schema.Literals(["ok", "timeout", "network", "not_found", "invalid", "unsupported"]),
  ),
  backoffUntil: Schema.NullOr(Schema.String),
});
export type RemoteStatus = typeof RemoteStatus.Type;
