/**
 * Defines development log paths and converts server output into shared records.
 * The wrapper, log reader and status report use it to rotate files and inspect the session.
 */

// The dev session's log files and their record format, shared by scripts/dev.ts (which writes
// logs/dev.jsonl), scripts/logs.ts (`bun run logs`, the reader) and the dev status report. Paths
// are relative to the repo root, which every caller chdirs to first.
//
//   logs/server.jsonl  the API's own records (apps/api/src/platform/node.ts, LOG_FILE): one per
//                      request, plus defects and anything the API logs
//   logs/dev.jsonl     everything else both dev servers print, one record per line: the site's
//                      dev server (Astro, Vite, proxy errors, and browser errors forwarded by
//                      Vite's forwardConsole) and API output that isn't a record (Node startup
//                      errors, watch restarts)
//   logs/dev.log       the terminal copy of both, prefixed [api] / [web], colors stripped
//
// Each `bun run dev` start moves the previous run's files to logs/*.prev.* first. A file that
// passes MAX_LOG_BYTES during a run moves to logs/*.old.*, which the reader doesn't read.
import { readFileSync } from "node:fs";

export const SERVER_LOG = "logs/server.jsonl";
export const OUTPUT_LOG = "logs/dev.jsonl";
export const TERMINAL_LOG = "logs/dev.log";
export const MAX_LOG_BYTES = 10 * 1024 * 1024;

/** A previous run's copy of a log file: logs/server.jsonl -> logs/server.prev.jsonl. */
export const previous = (file: string) => file.replace(/(\.[a-z]+)$/, ".prev$1");
/** Where an oversized file moves mid-run: logs/dev.jsonl -> logs/dev.old.jsonl. */
export const older = (file: string) => file.replace(/(\.[a-z]+)$/, ".old$1");

export type Source = "api" | "web";
export type LogRecord = { time: string; level: string; msg: string; source: Source } & Record<
  string,
  unknown
>;

export const LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export const levelRank = (level: string) => {
  const rank = (LEVELS as ReadonlyArray<string>).indexOf(level);
  return rank === -1 ? LEVELS.indexOf("info") : rank;
};

// What the API's development sink prints for each record it also writes to logs/server.jsonl:
// "<ISO time> <level> <msg> <the record as JSON>". Those lines are already records, so dev.ts
// doesn't copy them into logs/dev.jsonl.
const API_RECORD_LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z [a-z]+ .*\{.*\}$/;
// bun's note that a script ended on SIGINT or SIGTERM: what every dev:stop and Ctrl-C prints.
const STOP_NOTE = /^error: script "[^"]+" exited with code (130|143)$/;
// "error", "[ERROR]" and error class names (SyntaxError), but not a path or file name holding the
// word (/src/lib/error.ts, [200] /error).
const ERROR_WORD = /(?<![\w/.])[a-z]*error(?![\w/.])|\bERR!/i;
const WARN_WORD = /(?<![\w/.])warn(ing)?(?![\w/.])|\[WARN\]/i;

type Base = { time: string; source: Source };

/** The record for a line that is JSON: an API record, or Astro's {message, label, level}. */
function jsonOutputRecord(line: string, base: Base): LogRecord | undefined {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    parsed = Object.fromEntries(Object.entries(value));
  } catch {
    return undefined;
  }
  // Already a record: the API's startup failure, which it prints before its log file opens.
  if (typeof parsed.msg === "string" && typeof parsed.level === "string") {
    return { ...parsed, ...base, level: parsed.level, msg: parsed.msg };
  }
  if (typeof parsed.message !== "string") return undefined;
  const label =
    typeof parsed.label === "string" && parsed.label !== "SKIP_FORMAT"
      ? { label: parsed.label }
      : {};
  const level = typeof parsed.level === "string" ? parsed.level : "info";
  return { ...base, level, msg: parsed.message.trimEnd(), ...label };
}

const isStopNote = (line: string) => STOP_NOTE.test(line);

/** A plain-text line's level, from the words in it. */
export function plainLevel(line: string): string {
  if (isStopNote(line)) return "info";
  if (ERROR_WORD.test(line)) return "error";
  if (WARN_WORD.test(line)) return "warn";
  return "info";
}

/**
 * The logs/dev.jsonl record for one line a dev server printed (colors already stripped), or
 * undefined for a line that is already an API record. Astro prints JSON lines when it detects an
 * agent and plain text otherwise.
 */
export function outputRecord(source: Source, line: string, time: Date): LogRecord | undefined {
  if (source === "api" && API_RECORD_LINE.test(line)) return undefined;
  const base = { time: time.toISOString(), source };
  const json = line.startsWith("{") ? jsonOutputRecord(line, base) : undefined;
  return json ?? { ...base, level: plainLevel(line), msg: line };
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

function parseRecord(line: string, source: Source): LogRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const record = Object.fromEntries(Object.entries(value));
    return {
      ...record,
      source: record.source === "api" || record.source === "web" ? record.source : source,
      time: String(record.time ?? ""),
      level: String(record.level ?? "info"),
      msg: String(record.msg ?? ""),
    };
  } catch {
    // A line cut off by a crash mid-write; the rest of the file is still readable.
    return undefined;
  }
}

/** The records in a JSONL log file, oldest first, tagged with `source` when they carry none. */
export function readRecords(file: string, source: Source): LogRecord[] {
  return readText(file)
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => parseRecord(line, source) ?? []);
}

/** ISO times sort as plain strings; localeCompare would be slower and locale-dependent. */
function byTime(a: LogRecord, b: LogRecord): number {
  if (a.time < b.time) return -1;
  return a.time > b.time ? 1 : 0;
}

/** Every record of this run (or the previous one), oldest first. */
export function sessionRecords(prev = false): LogRecord[] {
  const file = (name: string) => (prev ? previous(name) : name);
  return [...readRecords(file(SERVER_LOG), "api"), ...readRecords(file(OUTPUT_LOG), "web")].sort(
    byTime,
  );
}

// Both files are written with JSON.stringify, so a level is always this exact text.
const PROBLEM_LINE = /"level":"(warn|error|fatal)"/;

/** How many warn/error/fatal records this run has, by scanning lines without parsing them. */
export function countProblems(): number {
  let count = 0;
  for (const file of [SERVER_LOG, OUTPUT_LOG]) {
    for (const line of readText(file).split("\n")) if (PROBLEM_LINE.test(line)) count += 1;
  }
  return count;
}
