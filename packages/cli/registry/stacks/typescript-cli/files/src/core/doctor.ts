import { Effect } from "effect";
import { AppConfig } from "../config";
import { errorTable } from "../errors";
import type { DoctorResult } from "../schemas/doctor";
import { Host } from "../services/host";

export const doctor = Effect.fn("doctor")(function* (): Effect.fn.Return<
  typeof DoctorResult.Type,
  never,
  AppConfig | Host
> {
  const config = yield* AppConfig;
  const host = yield* Host;
  const settings = yield* config.load.pipe(
    Effect.map((value) => ({ greeting: value.greeting, configError: null })),
    Effect.catch((error) =>
      Effect.succeed({ greeting: null, configError: errorTable[error._tag].message }),
    ),
  );
  yield* Effect.logDebug("configuration checked");
  if (settings.configError) yield* Effect.logWarning("configuration unavailable");
  return { ...host, configFile: config.configFile, dataDir: config.dataDir, ...settings };
});
