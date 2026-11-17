/**
 * Handles telemetry settings and queue controls. Declining collection needs no confirmation
 * (trust point 4).
 */
import { Effect, FileSystem, Path, Schema } from "effect";
import { Command } from "effect/cli";
import { AppConfig } from "../config";
import { PermissionDenied } from "../errors";
import { Settings } from "../schemas/config";
import {
  TelemetryFlush,
  TelemetryReset,
  TelemetrySetting,
  TelemetryStatus,
} from "../schemas/telemetry";
import { Host } from "../services/host";
import { Output } from "../services/output";
import { Telemetry } from "../telemetry";
import { write } from "../telemetry/storage";

/** Fails unless a person at a terminal is running the command (trust model point 4). */
const requirePerson = Effect.gen(function* () {
  const config = yield* AppConfig;
  const host = yield* Host;
  if ((yield* config.agent) !== "none")
    return yield* new PermissionDenied({ details: { reason: "agent" } });
  if (!host.stdinIsTTY) return yield* new PermissionDenied({ details: { reason: "no-tty" } });
});

/** Writes `config.json` with its `telemetry` setting replaced, keeping every other setting. */
const saveSetting = Effect.fn("telemetry.saveSetting")(function* (enabled: boolean) {
  const config = yield* AppConfig;
  const settings = yield* config.readSettingsFile;
  const paths = yield* config.paths;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* write(
    { fs, path, root: path.dirname(paths.config) },
    path.basename(paths.config),
    Schema.encodeSync(Settings)({ ...settings, telemetry: enabled }),
  ).pipe(
    Effect.mapError(
      () => new PermissionDenied({ details: { reason: "write", path: paths.config } }),
    ),
  );
});

/**
 * `enable` and `disable`. Disabling also removes the queued events, identity and project links;
 * when that removal fails the setting still counts and the result says the data remains.
 */
const setConsent = Effect.fn("telemetry.setConsent")(function* (enabled: boolean) {
  if (enabled) yield* requirePerson;
  yield* saveSetting(enabled);
  const cleared = enabled || (yield* (yield* Telemetry).clear(false));
  yield* (yield* Output).result(
    Schema.encodeSync(TelemetrySetting)({ enabled, ...(!cleared ? { cleared: false } : {}) }),
    `Telemetry ${enabled ? "enabled" : "disabled"}.${cleared ? "" : " Pending data could not be removed."}`,
  );
});

function renderStatus(value: TelemetryStatus): string {
  return [
    `Telemetry: ${value.reason}`,
    `Queued: ${value.spooled}`,
    ...(value.installId ? [`Install: ${value.installId}`] : []),
    ...(value.noticeShownAt ? [`Notice shown: ${value.noticeShownAt}`] : []),
  ].join("\n");
}

const status = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const value = yield* (yield* Telemetry).status;
    yield* (yield* Output).result(Schema.encodeSync(TelemetryStatus)(value), renderStatus(value));
  }),
).pipe(
  Command.withDescription(
    "Report consent, notice, local identity and pending event count without sending. Exits 0, 2 on usage errors, 130 when interrupted.",
  ),
  Command.withShortDescription("Report telemetry consent and pending events."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Read local telemetry state" },
    { command: `${commandPath.join(" ")} --json`, description: "Get telemetry status as JSON" },
  ]),
);

const enable = Command.make("enable", {}, () => setConsent(true)).pipe(
  Command.withDescription(
    "Enable collection; requires a person with terminal stdin. Exits 0, 2 on usage errors, 3 on invalid settings (InvalidConfig), 6 on a missing person or write permission (PermissionDenied), 130 when interrupted.",
  ),
  Command.withShortDescription("Enable telemetry with a person's consent."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Enable from your own terminal" },
    { command: `${commandPath.join(" ")} --json`, description: "Enable and return JSON" },
  ]),
);

const disable = Command.make("disable", {}, () => setConsent(false)).pipe(
  Command.withDescription(
    "Disable collection and delete pending events, identity and project links. Exits 0, 2 on usage errors, 3 on invalid settings (InvalidConfig), 6 on write permissions (PermissionDenied), 130 when interrupted.",
  ),
  Command.withShortDescription("Disable telemetry and remove pending data."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Turn collection off" },
    {
      command: `${commandPath.join(" ")} --json`,
      description: "Disable under an agent or in a script",
    },
  ]),
);

const flush = Command.make("flush", {}, () =>
  Effect.gen(function* () {
    const value = yield* (yield* Telemetry).flushNow;
    yield* (yield* Output).result(
      Schema.encodeSync(TelemetryFlush)(value),
      `Telemetry: ${value.reason}\nSent: ${value.sent}; kept: ${value.kept}; rejected: ${value.rejected}`,
    );
  }),
).pipe(
  Command.withDescription(
    "Send up to 50 queued events now, subject to consent and backoff, with a 5 second deadline. Exits 0 even when delivery is unavailable, 2 on usage errors, 130 when interrupted.",
  ),
  Command.withShortDescription("Send pending telemetry subject to consent."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Attempt one bounded delivery" },
    {
      command: `${commandPath.join(" ")} --json`,
      description: "Get sent, kept and rejected counts",
    },
  ]),
);

const reset = Command.make("reset", {}, () =>
  Effect.gen(function* () {
    const reset = yield* (yield* Telemetry).clear(true);
    yield* (yield* Output).result(
      Schema.encodeSync(TelemetryReset)({ reset }),
      reset
        ? "Telemetry identity reset; queued events and project links removed."
        : "Telemetry reset could not complete; local state may remain.",
    );
  }),
).pipe(
  Command.withDescription(
    "Rotate the install identity and remove pending events and project links; keep consent. Exits 0, 2 on usage errors, 130 when interrupted.",
  ),
  Command.withShortDescription("Rotate telemetry identity and remove pending data."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Reset local identity and event history" },
    { command: `${commandPath.join(" ")} --json`, description: "Reset without terminal output" },
  ]),
);

export const telemetryCommand = Command.make("telemetry").pipe(
  Command.withDescription(
    "Control anonymous usage telemetry. Disable and reset work without a terminal or under an agent; enable needs a person. Each subcommand's --help lists its exits.",
  ),
  Command.withExamples(({ commandPath }) => [
    {
      command: `${commandPath.join(" ")} status`,
      description: "See whether collection is on, and why",
    },
    { command: `${commandPath.join(" ")} disable`, description: "Turn collection off" },
  ]),
  Command.withShortDescription("Inspect, disable or reset anonymous usage telemetry."),
  Command.withSubcommands([status, enable, disable, reset, flush]),
);
