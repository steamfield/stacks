// One JSON object per line on stdout. Callers pass only allowlisted fields: never request
// bodies, query strings, cookies, headers or raw error messages.
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  errorType?: string;
  count?: number;
};

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function logRecord(level: LogLevel, event: string, fields: LogFields = {}) {
  return { time: new Date().toISOString(), level, event, ...fields };
}

export function createLogger(
  minimum: LogLevel,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
) {
  return (level: LogLevel, event: string, fields?: LogFields) => {
    if (ORDER[level] < ORDER[minimum]) return;
    write(JSON.stringify(logRecord(level, event, fields)));
  };
}

let shared: ReturnType<typeof createLogger> | undefined;

/** The server's logger, at the configured level. */
export function log(level: LogLevel, event: string, fields?: LogFields) {
  shared ??= createLogger(serverConfig().logLevel);
  shared(level, event, fields);
}
