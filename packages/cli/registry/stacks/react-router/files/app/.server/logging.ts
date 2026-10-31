import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Logger, References } from "effect";
import type { AppConfig } from "./config";

export type LogEntry = {
  time: string;
  level: string;
  msg: string;
  detail: string[];
  error?: { class: string; stack: string[] };
  [key: string]: unknown;
};
const reserved = new Set([
  "time",
  "level",
  "msg",
  "detail",
  "error",
  "__proto__",
  "constructor",
  "prototype",
]);
const scalar = (value: unknown) =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? value
    : "[redacted]";

// Error messages can contain input and secrets; retain only the class and frames.
export function defectInfo(value: unknown): NonNullable<LogEntry["error"]> {
  const heading =
    value instanceof Error ? `${value.name}${value.message ? `: ${value.message}` : ""}` : "";
  const frames =
    value instanceof Error && value.stack?.startsWith(heading)
      ? value.stack
          .slice(heading.length)
          .split("\n")
          .filter((line) => /^\s+at /.test(line))
          .map((line) => line.trim())
      : [];
  return {
    class: value instanceof Error ? value.constructor.name : typeof value,
    stack: frames,
  };
}
export function entry(input: {
  date: Date;
  level: string;
  message: unknown;
  annotations?: Readonly<Record<string, unknown>>;
}): LogEntry {
  const values: unknown[] = Array.isArray(input.message) ? input.message : [input.message];
  const result: LogEntry = {
    time: input.date.toISOString(),
    level: input.level.toLowerCase(),
    msg: String(scalar(values[0] ?? "")),
    detail: values.slice(1).map((value) => String(scalar(value))),
  };
  for (const [key, value] of Object.entries(input.annotations ?? {})) {
    if (key === "defect") {
      result.error = defectInfo(value);
      continue;
    }
    result[reserved.has(key) ? `annotation_${key}` : key] =
      /secret|password|token|authorization|cookie|api[_-]?key|access[_-]?key/i.test(key)
        ? "[redacted]"
        : scalar(value);
  }
  return result;
}
export const makeLogger = (write: (record: LogEntry) => void) =>
  Logger.make((options) => {
    write(
      entry({
        date: options.date,
        level: options.logLevel,
        message: options.message,
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      }),
    );
  });
export function terminalLine(record: LogEntry, noColor = true) {
  const time = noColor ? record.time : `\u001b[2m${record.time}\u001b[0m`;
  return `${time} ${record.level} ${record.msg} ${JSON.stringify(record)}`;
}
export function fileSink(file: string, warn: (message: string) => void) {
  let warned = false;
  return (record: LogEntry) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(record)}\n`);
    } catch {
      if (!warned) {
        warned = true;
        try {
          warn("Log file unavailable; continuing with terminal logs.");
        } catch {
          /* A closed warning stream must not fail the request either. */
        }
      }
    }
  };
}
export function writer(config: AppConfig["Service"]) {
  const append = fileSink(config.logFile, (message) => process.stderr.write(`${message}\n`));
  return (record: LogEntry) => {
    if (config.production) process.stdout.write(`${JSON.stringify(record)}\n`);
    else {
      process.stderr.write(`${terminalLine(record, config.noColor || !process.stderr.isTTY)}\n`);
      append(record);
    }
  };
}
