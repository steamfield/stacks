/**
 * Decides whether an invocation may collect telemetry. The order matters because status reports
 * the first applicable reason.
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

/**
 * Opt-outs take precedence over build or machine limitations so status explains the user's
 * choice. Notice eligibility comes last because it only matters on a run that could send.
 */
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
