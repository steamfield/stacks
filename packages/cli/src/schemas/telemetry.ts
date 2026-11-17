/** Defines the telemetry consent reasons and command results. */
import { Schema } from "effect";

export const Consent = Schema.Literals([
  "flag",
  "offline",
  "do_not_track",
  "environment",
  "config",
  "config_invalid",
  "ci",
  "source_build",
  "no_endpoint",
  "home_not_writable",
  "not_notified",
  "enabled",
]);
export type Consent = typeof Consent.Type;

export const TelemetryStatus = Schema.Struct({
  reason: Consent,
  installId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  noticeShownAt: Schema.optionalKey(Schema.String),
  spooled: Schema.Int,
});
export type TelemetryStatus = typeof TelemetryStatus.Type;

export const TelemetryFlush = Schema.Struct({
  sent: Schema.Int,
  kept: Schema.Int,
  rejected: Schema.Int,
  reason: Consent,
});
export type TelemetryFlush = typeof TelemetryFlush.Type;

export const TelemetrySetting = Schema.Struct({
  enabled: Schema.Boolean,
  cleared: Schema.optionalKey(Schema.Boolean),
});

export const TelemetryReset = Schema.Struct({ reset: Schema.Boolean });

/** Any of the subcommands' results; `stacks schema telemetry` prints this union. */
export const TelemetryResult = Schema.Union([
  TelemetryStatus,
  TelemetryFlush,
  TelemetrySetting,
  TelemetryReset,
]);
