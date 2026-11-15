/**
 * The CLI's logger: every log record a command produces is built, queued and written here.
 *
 * Effect code logs with `Effect.log*`; `main.ts` installs `Logging.logger`, which turns each call
 * into a plain record through `entry` and queues it. Nothing is written while the command runs.
 * `main` calls `flush` once the command finishes: records go to the JSONL file named by
 * `STACKS_LOG_FILE` (when set) and, for the human audience only, to stderr as short lines. `main`
 * also builds the one `command` summary record per invocation with `entry`.
 *
 * Records are a contract: tools and tests read the JSONL file, so field names and shapes don't
 * change. `entry` is the only builder, and it keeps data out of the log. Annotation values must be
 * scalars, keys that look like secrets are redacted, and an error contributes only its tag,
 * message, exit status and stack, never an arbitrary cause object. A log sink failing (an
 * unwritable file, a closed stderr) never fails the command or changes its exit status.
 */
import { Context, Effect, FileSystem, Layer, Logger, Path, References } from "effect";
import type { LogSettings } from "./config";
import { type AppError, exitCode } from "./errors";
import { Output } from "./services/output";

type LogEntry = {
  time: string;
  level: string;
  msg: string;
  detail: string[];
  cause?: { name: string; message: string; status: number; stack?: string };
  [key: string]: unknown;
};
/** Record fields an annotation can't overwrite; an annotation with one of these names is prefixed. */
const RESERVED_FIELDS = new Set(["time", "level", "msg", "detail", "cause"]);
const SECRET_KEY = /password|secret|token|authorization/i;
/** A scalar passes through; anything else (objects, arrays, functions) is replaced, never serialized. */
const scalar = (value: unknown): string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? value
    : "[redacted]";
/** A defect's class and stack frames, without its message (which may carry data). */
export function defectTrace(defect: unknown): string {
  if (!(defect instanceof Error)) return typeof defect;
  const frames = (defect.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
  return [defect.name, ...frames.map((line) => line.trim())].join("\n");
}
/**
 * Builds one sanitized log record. The first message part is `msg` and the rest are `detail`;
 * annotations become top-level fields, and `error` becomes `cause`.
 */
export function entry(input: {
  date: Date;
  level: string;
  message: unknown;
  annotations?: Readonly<Record<string, unknown>>;
  error?: AppError;
}): LogEntry {
  const parts = (Array.isArray(input.message) ? input.message : [input.message]).map((part) =>
    String(scalar(part)),
  );
  const record: LogEntry = {
    time: input.date.toISOString(),
    level: input.level.toLowerCase(),
    msg: parts[0] ?? "",
    detail: parts.slice(1),
  };
  for (const [key, value] of Object.entries(input.annotations ?? {}))
    record[RESERVED_FIELDS.has(key) ? `annotation_${key}` : key] = SECRET_KEY.test(key)
      ? "[redacted]"
      : scalar(value);
  if (input.error)
    record.cause = {
      name: input.error._tag,
      message: input.error.message,
      status: exitCode(input.error),
      ...(input.error.stack ? { stack: input.error.stack } : {}),
    };
  return record;
}
/**
 * The invocation's logger and its queue of records. `flush` writes and empties the queue; with
 * `quiet` it skips stderr (the JSON and agent audiences) and still appends to the file.
 */
export class Logging extends Context.Service<
  Logging,
  {
    logger: Logger.Logger<unknown, void>;
    records: LogEntry[];
    flush: (settings: LogSettings, quiet?: boolean) => Effect.Effect<void>;
  }
>()("stacks/Logging") {
  static layer = Layer.effect(
    Logging,
    Effect.gen(function* () {
      const output = yield* Output;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const records: LogEntry[] = [];
      let warned = false;
      const logger = Logger.make((options) => {
        records.push(
          entry({
            date: options.date,
            level: options.logLevel,
            message: options.message,
            annotations: options.fiber.getRef(References.CurrentLogAnnotations),
          }),
        );
      });
      // One note per invocation, and none in quiet mode, where stderr carries only the failure.
      const warnUnavailable = (quiet: boolean) =>
        Effect.gen(function* () {
          if (!warned && !quiet) {
            warned = true;
            yield* output
              .note("Log file unavailable; continuing with stderr.")
              .pipe(Effect.ignoreCause);
          }
        });
      const appendRecord = (file: string, record: LogEntry, quiet: boolean) =>
        fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(file, `${JSON.stringify(record)}\n`, { flag: "a" })),
          Effect.catchCause(() => warnUnavailable(quiet)),
        );
      return {
        logger,
        records,
        flush: (settings, quiet = false) =>
          Effect.gen(function* () {
            for (const record of records.splice(0)) {
              // Telemetry's records are for the log file only, never a person's terminal.
              if (!quiet && record.telemetry !== true)
                yield* output.note(logLine(record, settings)).pipe(Effect.ignoreCause);
              if (settings.file) {
                yield* appendRecord(settings.file, record, quiet);
              }
            }
          }),
      };
    }),
  );
  static memory = () => Logging.layer;
}

/** A record as one stderr line: the whole JSON record, or time, level, message and outcome. */
function logLine(record: LogEntry, settings: LogSettings): string {
  if (settings.format === "json") return JSON.stringify(record);
  return `${record.time} ${record.level.toUpperCase()} ${record.msg} ${record.outcome ?? ""}`;
}
