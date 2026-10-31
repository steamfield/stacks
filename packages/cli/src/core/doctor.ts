import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { AppConfig } from "../config";
import { DoctorReport } from "../schemas";
import { Host } from "../services/host";
import { VERSION } from "../version";
import { bundledRoot } from "./registry/registry";
import { RemoteIndex } from "./remote-index";
export const doctor = Effect.gen(function* () {
  const host = yield* Host;
  const config = yield* AppConfig;
  const paths = yield* config.paths;
  const registry = yield* bundledRoot;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillFound = yield* fs.stat(path.join(host.skill, "stacks", "SKILL.md")).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.orElseSucceed(() => false),
  );
  const result = yield* Effect.result(config.get);
  const configErrors = result._tag === "Failure" ? [result.failure.message] : [];
  const data = result._tag === "Success" ? (result.success.dataDir ?? paths.data) : paths.data;
  const remote = yield* Effect.serviceOption(RemoteIndex);
  const remoteIndex = Option.isSome(remote)
    ? yield* remote.value.status
    : {
        url: (yield* config.indexUrl) ?? null,
        isDefaultUrl: false,
        offline: yield* config.offline,
        cachedAt: null,
        lastAttempt: null,
        lastOutcome: null,
        backoffUntil: null,
      };
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
