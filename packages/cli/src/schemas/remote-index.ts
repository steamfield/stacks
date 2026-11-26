/** Defines the remote index cache status reported by `doctor`. */
import { Schema } from "effect";

export const IndexOutcome = Schema.Literals([
  "ok",
  "timeout",
  "network",
  "not_found",
  "invalid",
  "signature",
  "unsupported",
]);

export const IndexFallbackReason = Schema.Literals([
  ...IndexOutcome.literals.filter((outcome) => outcome !== "ok"),
  "offline",
]);

export const RemoteStatus = Schema.Struct({
  url: Schema.NullOr(Schema.String),
  isDefaultUrl: Schema.Boolean,
  offline: Schema.Boolean,
  cachedAt: Schema.NullOr(Schema.String),
  lastAttempt: Schema.NullOr(Schema.String),
  lastOutcome: Schema.NullOr(IndexOutcome),
  backoffUntil: Schema.NullOr(Schema.String),
  /** The cached index's header fields and the stored ETag, present once an index was fetched. */
  commit: Schema.optionalKey(Schema.String),
  generatedAt: Schema.optionalKey(Schema.String),
  minCli: Schema.optionalKey(Schema.String),
  etag: Schema.optionalKey(Schema.String),
});
export type RemoteStatus = typeof RemoteStatus.Type;
