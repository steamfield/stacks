export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Values a record may carry. Never put request or response bodies, tokens or user input here. */
export type LogFields = Record<string, string | number | boolean | undefined>;

export type LogRecord = {
  level: Exclude<LogLevel, "silent">;
  event: string;
  time: string;
} & LogFields;

export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

const rank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

/**
 * A logger that writes one structured record per call to the browser console, dropping records
 * below `level`. The record is an object, so devtools can filter and expand it.
 */
export function createLogger(level: LogLevel, now: () => Date = () => new Date()): Logger {
  const write =
    (recordLevel: LogRecord["level"]) =>
    (event: string, fields: LogFields = {}): void => {
      if (rank[recordLevel] < rank[level]) return;
      const record: LogRecord = { ...fields, level: recordLevel, event, time: now().toISOString() };
      console[recordLevel](record);
    };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}
