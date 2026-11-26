/**
 * Structured log records with level filtering. The only module that writes to the console:
 * Biome's noConsole rule fails lint anywhere else.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, string | number | boolean | null>;
export type LogRecord = LogFields & { level: LogLevel; event: string; time: string };
export type LogSink = (record: LogRecord) => void;

export type Logger = Record<LogLevel, (event: string, fields?: LogFields) => void>;

const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else console.log(line);
};

export function createLogger(options: {
  level: LogLevel;
  sink?: LogSink;
  now?: () => Date;
}): Logger {
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());
  const threshold = LOG_LEVELS.indexOf(options.level);
  const write =
    (level: LogLevel) =>
    (event: string, fields: LogFields = {}) => {
      if (LOG_LEVELS.indexOf(level) < threshold) return;
      sink({ ...fields, level, event, time: now().toISOString() });
    };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}
