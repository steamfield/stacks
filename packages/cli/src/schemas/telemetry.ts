/**
 * The shapes of what `stacks telemetry <subcommand> --json` prints, and the consent reasons.
 *
 * Telemetry is the optional usage reporting in `telemetry/`. `Consent` is the reason collection is
 * on or off, decided by `telemetry/consent.ts::consent`, which stops at the first reason that
 * applies; only `enabled` means events are sent. Each subcommand prints one of the result shapes:
 * `status` the reason and the number of queued events, `flush` what was sent, `enable` and
 * `disable` the new setting (`cleared: false` when queued data couldn't be removed), and `reset`
 * whether stored state was removed.
 */
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
