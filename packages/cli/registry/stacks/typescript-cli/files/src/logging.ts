import { Context, Effect, FileSystem, Layer, Logger, Path, References } from "effect";
import type { LogSettings } from "./config";
import { Output } from "./services/output";

export type LogEntry = {
  time: string;
  level: string;
  msg: string;
  detail: string[];
  [key: string]: unknown;
};
// Keep the class and frames for diagnosis, excluding messages that may contain input.
export function defectTrace(value: unknown): string {
  if (!(value instanceof Error)) return typeof value;
  const frames = (value.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
  return [value.constructor.name, ...frames.map((line) => line.trim())].join("\n");
}

const reserved = new Set([
  "time",
  "level",
  "msg",
  "detail",
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
export function entry(input: {
  date: Date;
  level: string;
  message: unknown;
  annotations?: Readonly<Record<string, unknown>>;
}): LogEntry {
  const values: unknown[] = Array.isArray(input.message) ? input.message : [input.message];
  const record: LogEntry = {
    time: input.date.toISOString(),
    level: input.level.toLowerCase(),
    msg: String(scalar(values[0] ?? "")),
    detail: values.slice(1).map((value) => String(scalar(value))),
  };
  for (const [key, value] of Object.entries(input.annotations ?? {}))
    record[reserved.has(key) ? `annotation_${key}` : key] =
      /secret|password|token|authorization|cookie|api[_-]?key|access[_-]?key/i.test(key)
        ? "[redacted]"
        : scalar(value);
  return record;
}

export class Logging extends Context.Service<
  Logging,
  {
    logger: Logger.Logger<unknown, void>;
    flush: (settings: LogSettings) => Effect.Effect<void>;
  }
>()("app/Logging") {
  static layer = Layer.effect(
    Logging,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const output = yield* Output;
      const records: LogEntry[] = [];
      let warned = false;
      const logger = Logger.make((input) => {
        records.push(
          entry({
            date: input.date,
            level: input.logLevel,
            message: input.message,
            annotations: input.fiber.getRef(References.CurrentLogAnnotations),
          }),
        );
      });
      return {
        logger,
        flush: (settings) =>
          Effect.gen(function* () {
            for (const record of records.splice(0)) {
              const json = JSON.stringify(record);
              yield* output
                .note(
                  output.json || settings.format === "json"
                    ? json
                    : `${record.time} ${record.level} ${record.msg} ${JSON.stringify(record)}`,
                )
                .pipe(Effect.ignoreCause);
              if (!settings.file) continue;
              yield* fs.makeDirectory(path.dirname(settings.file), { recursive: true }).pipe(
                Effect.andThen(fs.writeFileString(settings.file, `${json}\n`, { flag: "a" })),
                Effect.catchCause(() =>
                  Effect.gen(function* () {
                    if (warned) return;
                    warned = true;
                    const warning = entry({
                      date: new Date(record.time),
                      level: "warn",
                      message: "Log file unavailable; continuing with stderr.",
                    });
                    yield* output
                      .note(
                        output.json || settings.format === "json"
                          ? JSON.stringify(warning)
                          : warning.msg,
                      )
                      .pipe(Effect.ignoreCause);
                  }),
                ),
              );
            }
          }),
      };
    }),
  );
}
