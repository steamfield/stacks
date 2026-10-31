import { Cause, Clock, Console, Effect, Exit, Logger, Random, References, Schema } from "effect";
import { CliConfig, CliError, CliOutput, Command, GlobalFlag } from "effect/cli";
import { cli } from "./cli";
import { AppConfig } from "./config";
import { BrokenPipe, errorTable, failure } from "./errors";
import { defectTrace, Logging } from "./logging";
import { Host } from "./services/host";
import { Output } from "./services/output";

// The audience must exist before parsing can fail. Successful handlers use parsed flags.
const isFalseLiteral = Schema.is(Schema.Literals(["false", "no", "off", "0", "n"]));
export function jsonRequested(args: readonly string[]): boolean {
  let json = false;
  for (const [index, arg] of args.entries()) {
    if (arg === "--") break;
    if (arg === "--no-json") json = false;
    if (arg === "--json") json = !isFalseLiteral(args[index + 1] ?? "");
    if (arg.startsWith("--json=")) json = !isFalseLiteral(arg.slice(7));
  }
  return json;
}

export const main = Effect.fn("main")(function* (
  args: readonly string[],
  program?: Effect.Effect<
    void,
    unknown,
    Command.Environment | Command.Services<ReturnType<typeof cli>>
  >,
) {
  const host = yield* Host;
  const output = yield* Output;
  const logging = yield* Logging;
  const config = yield* AppConfig;
  const settings = yield* config.logging;
  const formatter = yield* CliOutput.Formatter;
  let frameworkKind: "help" | "version" = "help";
  const capturedFormatter: CliOutput.Formatter = {
    ...formatter,
    formatHelpDoc: (doc) => {
      frameworkKind = "help";
      return formatter.formatHelpDoc(doc);
    },
    formatVersion: (name, version) => {
      frameworkKind = "version";
      return formatter.formatVersion(name, version);
    },
  };
  const framework: string[] = [];
  const capture = (...values: ReadonlyArray<unknown>) => {
    framework.push(values.map(String).join(" "));
  };
  const console: Console.Console = {
    assert: (_condition, ...values) => capture(...values),
    clear: () => {},
    count: capture,
    countReset: () => {},
    debug: capture,
    dir: capture,
    dirxml: capture,
    error: capture,
    group: capture,
    groupCollapsed: capture,
    groupEnd: () => {},
    info: capture,
    log: capture,
    table: capture,
    time: () => {},
    timeEnd: () => {},
    timeLog: capture,
    trace: capture,
    warn: capture,
  };
  const started = yield* Clock.currentTimeMillis;
  const runId = `${started}-${(yield* Random.next).toString(36).slice(2)}`;
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        restore(
          (
            program ??
            Command.runWith(cli(host.name), { version: host.version, renderErrors: false })(args)
          ).pipe(
            Effect.provideService(Console.Console, console),
            Effect.provideService(CliOutput.Formatter, capturedFormatter),
            Effect.provide(CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] })),
          ),
        ),
      );
      const reason = Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isFailReason) : undefined;
      const help =
        reason &&
        CliError.isCliError(reason.error) &&
        reason.error._tag === "ShowHelp" &&
        reason.error.errors.length === 0;
      let error = Exit.isFailure(exit) && !help ? failure(exit.cause) : undefined;
      if (!error) {
        if (framework.length) {
          const text = framework
            .join("\n")
            .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
          yield* output.result(
            frameworkKind === "version" ? { version: host.version } : { help: text },
            text,
          );
        }
        const written = yield* Effect.exit(output.flush);
        if (Exit.isFailure(written)) error = failure(written.cause);
      }
      if (error instanceof BrokenPipe) return 0;
      const status = error ? errorTable[error._tag].code : 0;
      if (error?._tag === "Defect")
        yield* Effect.logError("defect").pipe(
          Effect.annotateLogs({
            trace: Exit.isFailure(exit) ? defectTrace(Cause.squash(exit.cause)) : "unknown",
          }),
        );
      const level = error ? "Error" : settings.level;
      yield* Effect.logWithLevel(level === "None" ? "Info" : level)("command").pipe(
        Effect.annotateLogs({
          command: framework.length ? "framework" : "doctor",
          runId,
          exitCode: status,
          outcome: error ? "failure" : "success",
          errorTag: error?._tag ?? null,
          durationMs: (yield* Clock.currentTimeMillis) - started,
        }),
      );
      yield* logging.flush(settings);
      if (error) {
        const written = yield* Effect.exit(output.error(error));
        if (Exit.isFailure(written) && failure(written.cause) instanceof BrokenPipe) return 0;
      }
      return status;
    }),
  ).pipe(
    Effect.provide(Logger.layer([logging.logger])),
    Effect.provideService(References.MinimumLogLevel, settings.level),
    Effect.annotateLogs({ runId }),
  );
});
