/**
 * Decides whether this run may collect telemetry, and if not, why.
 *
 * The answer is a reason (`Consent`): `enabled`, or the first rule that turned telemetry off.
 * `stacks telemetry` shows the reason to the user, so the order of the checks below is behavior:
 * the user's own opt-outs (`--no-telemetry`, `--offline`, `DO_NOT_TRACK`,
 * `STACKS_TELEMETRY_DISABLED`, the settings file) win over the facts about this build and machine
 * (CI, a source build, no endpoint, an unwritable state directory), and the one-time notice
 * comes last, because a run that hasn't shown it yet sends nothing.
 *
 * `telemetry/index.ts` calls `consent` before every record and flush. `standingOff` tells it which
 * reasons keep telemetry off for good, so anything already queued is deleted.
 */
import { Effect, Option } from "effect";
import type { AppConfig } from "../config";
import type { Consent } from "../schemas/telemetry";
import { directory, Notice, read, type Storage } from "./storage";

/** Reasons that hold for every run in this environment, unlike a per-run flag; see `standingOff`. */
const STANDING_REASONS: ReadonlyArray<Consent> = ["do_not_track", "environment", "config", "ci"];

/**
 * Whether `reason` keeps telemetry off for every run here (an environment variable, the settings
 * file or CI), so events already queued will never be sent and are deleted.
 */
export const standingOff = (reason: Consent) => STANDING_REASONS.includes(reason);

/** Works through the consent rules in order and returns the first reason that applies. */
export const consent = Effect.fn("telemetry.consent")(function* (input: {
  config: AppConfig["Service"];
  store: Storage;
  url: string | undefined;
}) {
  const { config, store, url } = input;
  if (yield* config.noTelemetry) return "flag";
  if (yield* config.offline) return "offline";
  if (config.telemetry.doNotTrack) return "do_not_track";
  if (config.telemetry.disabled) return "environment";
  const settings = yield* Effect.result(config.settings);
  if (settings._tag === "Failure") return "config_invalid";
  if (settings.success.telemetry === false) return "config";
  if (config.ci) return "ci";
  if (!config.releaseBuild) return "source_build";
  if (!url) return "no_endpoint";
  if (!(yield* stateWritable(store))) return "home_not_writable";
  if (!(yield* noticeAcknowledged(store))) return "not_notified";
  return "enabled";
});

/** Proves the telemetry directory is writable by creating it and a scratch directory inside it. */
const stateWritable = (store: Storage) =>
  directory(store, store.root).pipe(
    Effect.andThen(Effect.scoped(store.fs.makeTempDirectoryScoped({ directory: store.root }))),
    Effect.result,
    Effect.map((attempt) => attempt._tag === "Success"),
  );

/**
 * Whether the notice has been shown, judged from `notice.json`.
 *
 * A pending first-notice claim means some run is printing the notice right now and hasn't
 * confirmed the user saw it, so it doesn't count yet. A pending claim for the second notice
 * (`second:` ids) still counts, since the user already saw the first one.
 */
const noticeAcknowledged = Effect.fn("telemetry.noticeAcknowledged")(function* (store: Storage) {
  const notice = yield* read(store, "notice.json", Notice).pipe(Effect.option);
  if (Option.isNone(notice)) return false;
  return !(notice.value.pending && !notice.value.claimId?.startsWith("second:"));
});
