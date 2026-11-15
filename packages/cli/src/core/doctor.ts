/**
 * Collects what `stacks doctor` reports: the facts someone needs to tell why the CLI misbehaves on
 * their machine.
 *
 * The report holds the version and platform, the directories the CLI uses, whether the bundled
 * registry (the stacks and fragments shipped in the package) and the bundled agent skill were
 * found, the remote index's cache status and any error reading `config.json`. Doctor has to work
 * when everything else is broken, so a bad config file is reported in `configErrors` instead of
 * failing, and the remote index is described from config alone when its service isn't provided.
 * Nothing here refreshes the index or reaches the network.
 *
 * `commands/doctor.ts` runs `doctor` and renders the encoded `DoctorReport` (`schemas/doctor.ts`).
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { AppConfig } from "../config";
import { DoctorReport } from "../schemas/doctor";
import type { RemoteStatus } from "../schemas/remote-index";
import { Host } from "../services/host";
import { VERSION } from "../version";
import { bundledRoot } from "./registry/registry";
import { RemoteIndex } from "./remote-index";

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
