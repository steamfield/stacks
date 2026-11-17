/**
 * Collects installation and configuration diagnostics, including cached `RemoteIndex.status`.
 * Reporting settings errors as data lets diagnosis work on a broken installation.
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { AppConfig } from "../config";
import { DoctorReport } from "../schemas/doctor";
import type { RemoteStatus } from "../schemas/remote-index";
import { Host } from "../services/host";
import { VERSION } from "../version";
import { RemoteIndex } from "./registry/remote/service";
import { bundledRoot } from "./registry/roots";

/** Whether the bundled skills root holds `stacks/SKILL.md`; any failure to look counts as absent. */
const skillInstalled = (skillRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.stat(path.join(skillRoot, "stacks", "SKILL.md")).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );
  });

/**
 * Reads `config.json` without failing: its error message, if any, and the data directory it
 * sets, falling back to the default when the file is broken or doesn't set one.
 */
const configState = (defaultData: string) =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const read = yield* Effect.result(config.get);
    if (read._tag === "Failure") return { configErrors: [read.failure.message], data: defaultData };
    return { configErrors: [], data: read.success.dataDir ?? defaultData };
  });

/** The remote index's status, or an empty one built from config when the service is absent. */
const remoteIndexStatus = Effect.gen(function* () {
  const remote = yield* Effect.serviceOption(RemoteIndex);
  if (Option.isSome(remote)) return yield* remote.value.status;
  const config = yield* AppConfig;
  const status: RemoteStatus = {
    url: (yield* config.indexUrl) ?? null,
    isDefaultUrl: false,
    offline: yield* config.offline,
    cachedAt: null,
    lastAttempt: null,
    lastOutcome: null,
    backoffUntil: null,
  };
  return status;
});

export const doctor = Effect.gen(function* () {
  const host = yield* Host;
  const config = yield* AppConfig;
  const paths = yield* config.paths;
  const registry = yield* bundledRoot;
  const skillFound = yield* skillInstalled(host.skill);
  const { configErrors, data } = yield* configState(paths.data);
  const remoteIndex = yield* remoteIndexStatus;
  return Schema.encodeSync(DoctorReport)({
    version: VERSION,
    platform: host.platform,
    executable: host.executable,
    paths: { config: paths.config, data, cache: paths.cache, cwd: host.cwd, user: paths.user },
    registry: { path: registry.path, found: registry.found },
    skill: { path: host.skill, found: skillFound },
    configErrors,
    remoteIndex,
  });
});
