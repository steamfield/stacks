import { Config, ConfigProvider, Context, Effect, Layer, Option, Schema } from "effect";

export const levels = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
  none: "None",
} as const;
const read = Effect.gen(function* () {
  const raw = yield* Config.String("LOG_LEVEL").pipe(Config.withDefault("info"));
  const logLevel = yield* Schema.decodeUnknownEffect(
    Schema.Literals(["trace", "debug", "info", "warn", "error", "fatal", "none"]),
  )(raw.toLowerCase());
  return {
    maxBodyBytes: yield* Config.schema(
      Schema.Int.check(Schema.isGreaterThan(0)),
      "MAX_BODY_BYTES",
    ).pipe(Config.withDefault(4096)),
    greeting: yield* Config.schema(Schema.String.check(Schema.isPattern(/\S/)), "GREETING").pipe(
      Config.withDefault("Hello"),
    ),
    logLevel,
    production:
      (yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"))) === "production",
    logFile: yield* Config.String("LOG_FILE").pipe(Config.withDefault("logs/server.jsonl")),
    noColor: Option.isSome(yield* Config.option(Config.String("NO_COLOR"))),
  };
});
export class AppConfig extends Context.Service<AppConfig, Effect.Success<typeof read>>()(
  "app/AppConfig",
) {
  static readonly layer = Layer.effect(this, read);
}
export const environment = () => ConfigProvider.fromEnv();
