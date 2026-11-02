import { createRequire } from "node:module";
import { Context, Duration, Effect, FileSystem, Layer, LogLevel, Path, Schema } from "effect";
import { ConfigInvalid } from "./errors";

export interface McpConfigShape {
  readonly node: string;
  readonly cliEntry: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeout: Duration.Duration;
  readonly logLevel: LogLevel.LogLevel;
}

const Dependency = Schema.Struct({
  name: Schema.Literal("@steamfield/stacks"),
  bin: Schema.Struct({ stacks: Schema.String }),
});
const missingDependency =
  "Cannot resolve @steamfield/stacks. Install it or set STACKS_MCP_CLI to its absolute dist/stacks entry.";

const dependencyEntry = Effect.fn("config.dependencyEntry")(function* (
  dependency: { readonly packageJson: string } | undefined,
) {
  if (dependency === undefined) return yield* new ConfigInvalid({ message: missingDependency });
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs
    .readFileString(dependency.packageJson)
    .pipe(
      Effect.mapError(
        (error) => new ConfigInvalid({ message: `${missingDependency} ${error.message}` }),
      ),
    );
  const metadata = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Dependency))(text).pipe(
    Effect.mapError(
      (error) => new ConfigInvalid({ message: `${missingDependency} ${error.message}` }),
    ),
  );
  return path.join(path.dirname(dependency.packageJson), metadata.bin.stacks);
});

const validateEntry = Effect.fn("config.validateEntry")(function* (entry: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const invalid = (detail: string) =>
    new ConfigInvalid({
      message: `STACKS_MCP_CLI must name an existing absolute CLI file from @steamfield/stacks: ${entry}. ${detail}`,
    });
  if (!path.isAbsolute(entry)) return yield* invalid("Relative paths are not supported.");
  const stat = yield* fs.stat(entry).pipe(Effect.mapError((error) => invalid(error.message)));
  if (stat.type !== "File") return yield* invalid("The entry is not a file.");
  return yield* fs.realPath(entry).pipe(Effect.mapError((error) => invalid(error.message)));
});

const timeoutValue = Effect.fn("config.timeout")(function* (value: string | undefined) {
  if (value === undefined) return Duration.seconds(900);
  const seconds = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(seconds) || seconds <= 0) {
    return yield* new ConfigInvalid({
      message: "STACKS_MCP_TIMEOUT_SECONDS must be a positive integer.",
    });
  }
  return Duration.seconds(seconds);
});

export const resolveConfig = Effect.fn("config.resolveConfig")(function* (input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  readonly dependency: { readonly packageJson: string } | undefined;
}): Effect.fn.Return<McpConfigShape, ConfigInvalid, FileSystem.FileSystem | Path.Path> {
  const entry = input.env.STACKS_MCP_CLI ?? (yield* dependencyEntry(input.dependency));
  const cliEntry = yield* validateEntry(entry);
  const timeout = yield* timeoutValue(input.env.STACKS_MCP_TIMEOUT_SECONDS);
  const rawLevel = (input.env.STACKS_MCP_LOG_LEVEL ?? "Info").toLowerCase();
  const logLevel = yield* Schema.decodeUnknownEffect(Schema.Literals(LogLevel.values))(
    rawLevel.charAt(0).toUpperCase() + rawLevel.slice(1),
  ).pipe(
    Effect.mapError(
      (error) =>
        new ConfigInvalid({
          message: `STACKS_MCP_LOG_LEVEL is invalid: ${error.message}`,
        }),
    ),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { node: input.execPath, cliEntry, timeout, logLevel, env };
});

export class McpConfig extends Context.Service<McpConfig, McpConfigShape>()(
  "stacks-mcp/McpConfig",
) {
  static readonly fixed = (shape: McpConfigShape): Layer.Layer<McpConfig> =>
    Layer.succeed(McpConfig, shape);

  static readonly layer = Layer.effect(
    McpConfig,
    Effect.gen(function* () {
      const env = process.env;
      let dependency: { readonly packageJson: string } | undefined;
      // Resolve the declared dependency through Node, including in an installed tarball.
      if (env.STACKS_MCP_CLI === undefined) {
        const packageJson = yield* Effect.try({
          try: () => createRequire(import.meta.url).resolve("@steamfield/stacks/package.json"),
          catch: (cause) => new ConfigInvalid({ message: `${missingDependency} ${String(cause)}` }),
        });
        dependency = { packageJson };
      }
      return yield* resolveConfig({
        env,
        execPath: process.execPath,
        dependency,
      });
    }),
  );
}
