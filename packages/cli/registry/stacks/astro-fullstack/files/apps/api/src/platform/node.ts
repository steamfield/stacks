import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname } from "node:path";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Cause, ConfigProvider, Effect, Layer, Logger, References } from "effect";
import { HttpRouter } from "effect/http";
import { App } from "../app.ts";
import { AppConfig } from "../config.ts";
import { type LogEntry, makeLogger, terminalLine } from "../logging.ts";

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

export function fileSink(file: string, warn: (message: string) => void) {
  let warned = false;
  return (record: LogEntry) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const size = fileSize(file);
      const line = `${JSON.stringify(record)}\n`;
      if (size + Buffer.byteLength(line) > 10 * 1024 * 1024) {
        const ext = extname(file);
        renameSync(file, `${file.slice(0, file.length - ext.length)}.old${ext}`);
      }
      appendFileSync(file, line);
    } catch {
      if (!warned) {
        warned = true;
        try {
          warn("Log file unavailable; continuing with terminal logs.");
        } catch {
          /* A closed fallback sink must not fail a request either. */
        }
      }
    }
  };
}

const levels = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
  none: "None",
} as const;

export const Server = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const append = fileSink(config.logFile, (message) => process.stderr.write(`${message}\n`));
    const logger = makeLogger((record) => {
      if (config.production) process.stdout.write(`${JSON.stringify(record)}\n`);
      else {
        process.stderr.write(`${terminalLine(record, config.noColor || !process.stderr.isTTY)}\n`);
        append(record);
      }
    });
    return HttpRouter.serve(App, { disableLogger: true, disableListenLog: true }).pipe(
      Layer.provideMerge(
        NodeHttpServer.layer(createServer, {
          port: config.port,
          gracefulShutdownTimeout: "5 seconds",
        }),
      ),
      Layer.provide(Logger.layer([logger])),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, levels[config.logLevel])),
    );
  }),
).pipe(Layer.provide(AppConfig.layer));

const main = Layer.launch(Server).pipe(
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.logError("startup: check PORT_API, PORT, LOG_LEVEL and listener availability"),
  ),
  Effect.provide(
    Logger.layer([makeLogger((record) => process.stderr.write(`${JSON.stringify(record)}\n`))]),
  ),
);
if (import.meta.main) NodeRuntime.runMain(main, { disableErrorReporting: true });
