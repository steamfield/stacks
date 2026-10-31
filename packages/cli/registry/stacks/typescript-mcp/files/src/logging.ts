import { type DestinationStream, type Logger, type LoggerOptions, pino } from "pino";

export type { Logger } from "pino";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// A backstop for keys that must never be written, wherever they appear one level down. Tool call
// records don't need it: they carry only the fields runTool chooses, never arguments.
const REDACT = [
  "authorization",
  "password",
  "token",
  "secret",
  "*.authorization",
  "*.password",
  "*.token",
  "*.secret",
];

/**
 * JSON lines with an ISO time and a text level, written to stderr (file descriptor 2). On stdio,
 * stdout carries the protocol and nothing else may write there. Pass `destination` to capture
 * records in tests.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT, censor: "[redacted]" },
  };
  // Synchronous, so a record written just before exit is never lost and no handle keeps the
  // process alive after the client closes stdin.
  return pino(options, destination ?? pino.destination({ dest: 2, sync: true }));
}
