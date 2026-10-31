import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { type DestinationStream, type Logger, type LoggerOptions, pino } from "pino";

export type { Logger } from "pino";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// A backstop for keys that must never be written, wherever they appear one level down. Request
// records don't need it: they carry only the allowlisted fields below.
const REDACT = [
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.secret",
];

/**
 * JSON lines with an ISO time and a text level. Pass `destination` to capture records (tests);
 * by default pino writes to stdout, and `bun run dev` pipes that through pino-pretty.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT, censor: "[redacted]" },
  };
  return destination ? pino(options, destination) : pino(options);
}

/**
 * One record per request after the response is ready: method, route pattern (never the raw URL,
 * whose query may hold secrets), status, duration and request id. Health probes log at debug.
 */
export function requestLogger(logger: Logger): MiddlewareHandler<{
  Variables: { requestId: string };
}> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const route = routePath(c);
    const record = {
      requestId: c.get("requestId"),
      method: c.req.method,
      route: route === "/*" ? "(unmatched)" : route,
      status: c.res.status,
      durationMs: Math.round((performance.now() - started) * 10) / 10,
    };
    const level = route === "/healthz" ? "debug" : "info";
    logger[level](record, "request");
  };
}
