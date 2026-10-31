import { Config, Context, Effect, Layer, Option, Schema } from "effect";

// Node's port zero asks the listener to own an ephemeral port.
const portSetting = (name: string) =>
  Config.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })), name);

const read = Effect.gen(function* () {
  const preferredPort = yield* Config.option(portSetting("PORT_API"));
  const port = Option.isSome(preferredPort)
    ? preferredPort.value
    : yield* portSetting("PORT").pipe(Config.withDefault(3000));
  const level = yield* Config.String("LOG_LEVEL").pipe(Config.withDefault("info"));
  const logLevel = yield* Schema.decodeUnknownEffect(
    Schema.Literals(["trace", "debug", "info", "warn", "error", "fatal", "none"]),
  )(level.toLowerCase());
  return {
    port,
    maxBodyBytes: yield* Config.schema(
      Schema.Int.check(Schema.isGreaterThan(0)),
      "MAX_BODY_BYTES",
    ).pipe(Config.withDefault(65536)),
    logLevel,
    production:
      (yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"))) === "production",
    logFile: yield* Config.String("LOG_FILE").pipe(Config.withDefault("logs/server.jsonl")),
    staticDir: yield* Config.String("STATIC_DIR").pipe(Config.withDefault("")),
    noColor: Option.isSome(yield* Config.option(Config.String("NO_COLOR"))),
  };
});

export class AppConfig extends Context.Service<AppConfig, Effect.Success<typeof read>>()(
  "api/AppConfig",
) {
  static readonly layer = Layer.effect(this, read);
}
