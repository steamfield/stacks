/**
 * Checks for a newer version and upgrades a confirmed global npm install when requested. Offline
 * checks are refused because there is no cached version to compare.
 */
import { Duration, Effect, Schema } from "effect";
import { AppConfig } from "../../config";
import { BadInput, PermissionDenied, UpdateFailed } from "../../errors";
import type { UpdateResult } from "../../schemas/update";
import { Output } from "../../services/output";
import { Processes } from "../../services/processes";
import { PACKAGE, VERSION } from "../../version";
import { shellArg } from "../shell";
import { installMethod } from "./install";
import { latestVersion } from "./latest";
import { compareVersions, Version } from "./version";

type Install = Extract<UpdateResult, { status: "available" }>["install"];

/** Suggest `npx` to callers whose running copy came from the npx cache. */
function updateCommand(install: Install, latest: string): string {
  return install === "npx"
    ? `npx -y ${PACKAGE}@${shellArg(latest)}`
    : `npm install -g ${PACKAGE}@${shellArg(latest)}`;
}

/**
 * Pass the decoded version as fixed argv (trust point 1). Report a spawn failure, timeout or
 * nonzero exit as `UpdateFailed`.
 */
const installLatest = Effect.fn("update.installLatest")(function* (options: {
  npm: string;
  latest: string;
  command: string;
  timeout: Duration.Duration;
}) {
  const config = yield* AppConfig;
  // Refuse a detected agent because updating tools is a person's decision (trust point 4).
  if ((yield* config.agent) !== "none")
    return yield* new PermissionDenied({ details: { reason: "agent" } });
  const processes = yield* Processes;
  const output = yield* Output;
  const { home } = yield* config.paths;
  yield* output.progress(`Installing ${PACKAGE}@${options.latest} with npm...`);
  const installed = yield* processes
    .exec({
      argv: [options.npm, "install", "-g", `${PACKAGE}@${options.latest}`],
      cwd: home,
      env: config.childEnv([]),
      timeout: options.timeout,
    })
    .pipe(Effect.mapError(() => new UpdateFailed({ details: { command: options.command } })));
  if (installed.timedOut)
    return yield* new UpdateFailed({ details: { command: options.command, timedOut: true } });
  if (installed.exitCode !== 0)
    return yield* new UpdateFailed({
      details: { command: options.command, exitCode: installed.exitCode },
    });
});

export const update = Effect.fn("update.update")(function* (options: {
  check: boolean;
  current?: string;
  registryTimeout?: Duration.Duration;
  detectionTimeout?: Duration.Duration;
  installTimeout?: Duration.Duration;
}) {
  // The running version is the CLI's own constant (or a test's), so a bad one is a bug.
  const current = yield* Schema.decodeUnknownEffect(Version)(options.current ?? VERSION).pipe(
    Effect.orDie,
  );
  if (yield* (yield* AppConfig).offline)
    return yield* new BadInput({ details: { flag: "offline" } });
  const latest = yield* latestVersion(options.registryTimeout);
  const compared = compareVersions(latest, current);
  if (compared === 0) return { status: "up-to-date", current, latest } satisfies UpdateResult;
  if (compared < 0) return { status: "ahead", current, latest } satisfies UpdateResult;
  const installation = yield* installMethod(options.detectionTimeout);
  const command = updateCommand(installation.install, latest);
  if (options.check || installation.install !== "npm-global")
    return {
      status: "available",
      current,
      latest,
      install: installation.install,
      command,
    } satisfies UpdateResult;
  yield* installLatest({
    npm: installation.npm,
    latest,
    command,
    timeout: options.installTimeout ?? Duration.minutes(5),
  });
  return { status: "updated", current, latest, install: "npm-global" } satisfies UpdateResult;
});
