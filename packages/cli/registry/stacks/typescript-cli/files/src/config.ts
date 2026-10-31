import { Config, ConfigProvider, Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { InvalidConfig, PermissionDenied } from "./errors";
import { Host } from "./services/host";

export const levels = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
  none: "None",
} as const;
const Level = Schema.Literals(["trace", "debug", "info", "warn", "error", "fatal", "none"]);
const Greeting = Schema.String.check(Schema.isPattern(/\S/));
const ConfigFile = Schema.Struct({
  greeting: Schema.optionalKey(Greeting),
  logLevel: Schema.optionalKey(Level),
});
export type Settings = { greeting: string };
export type LogSettings = {
  level: (typeof levels)[keyof typeof levels];
  format: "json" | "pretty";
  file: string;
};

export class AppConfig extends Context.Service<
  AppConfig,
  {
    load: Effect.Effect<Settings, InvalidConfig | PermissionDenied>;
    logging: Effect.Effect<LogSettings>;
    configFile: string;
    dataDir: string;
  }
>()("app/AppConfig") {
  static layer = (env: Readonly<Record<string, string | undefined>>) =>
    Layer.effect(
      AppConfig,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const host = yield* Host;
        const prefix = host.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
        const provider = ConfigProvider.fromEnvRecord(
          Object.fromEntries(
            Object.entries(env).map(([key, value]) => [key, value?.trim() ? value : undefined]),
          ),
        );
        const read = <A>(config: Config.Config<A>) =>
          config.pipe(Effect.provide(ConfigProvider.layer(provider)));
        const text = (key: string, fallback = "") =>
          read(Config.String(key).pipe(Config.withDefault(fallback))).pipe(Effect.orDie);
        const home = yield* text("HOME", ".");
        const base = yield* text("XDG_CONFIG_HOME", path.join(home, ".config"));
        const configFile = path.join(base, host.name, "config.json");
        const dataHome = yield* text("XDG_DATA_HOME", path.join(home, ".local/share"));
        const dataDir = yield* text(`${prefix}_DATA_DIR`, path.join(dataHome, host.name));
        const file = yield* Effect.cached(
          fs.readFileString(configFile).pipe(
            Effect.catch((error) =>
              error.reason._tag === "NotFound"
                ? Effect.succeed("{}")
                : Effect.fail(new PermissionDenied()),
            ),
            Effect.flatMap((content) =>
              Effect.try({
                try: () => JSON.parse(content) as unknown,
                catch: () => new InvalidConfig(),
              }),
            ),
          ),
        );
        const load = yield* Effect.cached(
          Effect.gen(function* () {
            const config = yield* file.pipe(
              Effect.flatMap((value) =>
                Schema.decodeUnknownEffect(ConfigFile)(value, { onExcessProperty: "error" }),
              ),
              Effect.mapError((error) =>
                error instanceof PermissionDenied ? error : new InvalidConfig(),
              ),
            );
            const greeting = yield* text(`${prefix}_GREETING`, config.greeting ?? "Hello, world!");
            return {
              greeting: yield* Schema.decodeUnknownEffect(Greeting)(greeting).pipe(
                Effect.mapError(() => new InvalidConfig()),
              ),
            };
          }),
        );
        const logging = Effect.gen(function* () {
          const config = yield* file.pipe(
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(Schema.Struct({ logLevel: Schema.optionalKey(Level) }))(
                value,
              ),
            ),
            Effect.catch(() => Effect.succeed({ logLevel: undefined })),
          );
          const raw = (yield* text("LOG_LEVEL", config.logLevel ?? "warn")).toLowerCase();
          const level = yield* Schema.decodeUnknownEffect(Level)(raw).pipe(
            Effect.orElseSucceed(() => "warn" as const),
          );
          const format = yield* text(`${prefix}_LOG_FORMAT`);
          return {
            level: levels[level],
            format: format === "json" ? ("json" as const) : ("pretty" as const),
            file: yield* text(`${prefix}_LOG_FILE`),
          };
        });
        return { load, logging, configFile, dataDir };
      }),
    );
}
