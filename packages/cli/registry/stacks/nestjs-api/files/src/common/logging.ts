import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/** Nest's levels, quietest last. LOG_LEVEL names the lowest one written. */
export const LOG_LEVELS = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
] as const satisfies readonly LogLevel[];

export type AppLogLevel = (typeof LOG_LEVELS)[number];

/** `level` and every level above it. */
export function levelsFrom(level: AppLogLevel): LogLevel[] {
  return LOG_LEVELS.slice(LOG_LEVELS.indexOf(level));
}

// A backstop for keys that must never be written, at any depth. Request records
// don't need it: they carry only the fields RequestContextMiddleware picks.
const REDACT = ['authorization', 'cookie', 'password', 'token', 'secret'];

/**
 * Nest's own logger writing one JSON object per line: level, pid, timestamp,
 * message, context, and the fields passed after the message at the top level.
 */
export function createLogger(level: AppLogLevel): ConsoleLogger {
  return new ConsoleLogger({
    json: true,
    logLevels: levelsFrom(level),
    flattenParams: true,
    redact: REDACT,
  });
}
