import { Logger, References } from "effect";

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

function stackFrames(error: Error) {
  const header = [error.name, error.message].filter((part) => part !== "").join(": ");
  const stack = error.stack ?? "";
  if (!stack.startsWith(header)) return [];
  return stack
    .slice(header.length)
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .map((line) => line.trim());
}

export function defectInfo(value: unknown): NonNullable<LogEntry["error"]> {
  return {
    class: value instanceof Error ? value.constructor.name : typeof value,
    stack: value instanceof Error ? stackFrames(value) : [],
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
      /secret|password|token|authorization|cookie/i.test(key) ? "[redacted]" : scalar(value);
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

export function terminalLine(record: LogEntry, noColor = true): string {
  const time = noColor ? record.time : `\u001b[2m${record.time}\u001b[0m`;
  return `${time} ${record.level} ${record.msg} ${JSON.stringify(record)}`;
}
