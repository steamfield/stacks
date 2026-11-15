/**
 * The remote index's cache status, as `stacks doctor` reports it.
 *
 * The remote index is an optional signed list of entries the CLI downloads and caches for 24 hours
 * (`core/remote-index.ts`). `url` is null when no index is configured. The other fields say when
 * the cache was filled, how the last request went, and until when failed requests are held back.
 */
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
