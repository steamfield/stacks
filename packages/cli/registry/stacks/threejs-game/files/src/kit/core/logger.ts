/**
 * Namespaced logger. Game code uses this instead of console.* (lint enforces it). Output goes to a
 * sink the shell installs, because game logic compiles without DOM types and has no console.
 * Filter with ?log=debug or ?log=<namespace prefix>.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  namespace: string;
  message: string;
  data?: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let sink: LogSink = () => {};
let minLevel: LogLevel = "info";
let namespaces: string[] = [];

/**
 * Called once by the shell. `filter` is the ?log= value: a level, or comma-separated namespace
 * prefixes (which enable debug for them).
 */
export function configureLogging(newSink: LogSink, filter = ""): void {
  sink = newSink;
  minLevel = "info";
  namespaces = [];
  for (const part of filter
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (part in ORDER) minLevel = part as LogLevel;
    else namespaces.push(part);
  }
}

export function createLogger(namespace: string): Logger {
  const log = (level: LogLevel) => (message: string, data?: unknown) => {
    const forced = namespaces.some((n) => namespace.startsWith(n));
    if (!forced && ORDER[level] < ORDER[minLevel]) return;
    sink(data === undefined ? { level, namespace, message } : { level, namespace, message, data });
  };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}
