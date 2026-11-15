#!/usr/bin/env bun
/**
 * Filters and prints the current or previous development session's records as text or JSON lines.
 * It reads the shared log format so callers can inspect failures without restarting servers.
 */

// `bun run logs`: the dev session's records from both servers, merged in time order, one line
// each. The files and their format are in scripts/dev-logs.ts. `--help` lists the filters.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LEVELS, type LogRecord, levelRank, sessionRecords } from "./dev-logs";

const HELP = `Usage: bun run logs [filters]

The dev servers' records, oldest first: the API's (logs/server.jsonl) and everything else
either server printed, including the site's proxy errors and browser errors (logs/dev.jsonl).

  --level <level>    this level and above: ${LEVELS.join(", ")}
  --source <name>    api or web
  --request <id>     one request id (the API's x-request-id)
  --path <prefix>    API requests whose path starts with prefix
  --since <time>     the last 30s, 10m, 2h, or since an ISO time
  --grep <text>      records whose message or fields contain text (any case)
  --tail <n>         the last n records after filtering (default 100, or all with --json;
                     0 for all)
  --prev             the previous run's files (logs/*.prev.*) instead
  --json             the matching records as JSON lines, for jq

Examples:
  bun run logs --level warn --since 10m
  bun run logs --request client-123
  bun run logs --source web --grep proxy`;

class UsageError extends Error {}

type Filters = {
  level?: string | undefined;
  source?: string | undefined;
  request?: string | undefined;
  path?: string | undefined;
  since?: string | undefined;
  grep?: string | undefined;
};

// An ISO date, optionally with a time and zone: 2026-10-27, 2026-10-27T14:05, ...T14:05:00.000Z.
// Anything looser goes through Date's lenient parser, which reads "12" as 2001-12-01.
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** The earliest record time `--since` keeps, as an ISO string. */
export function sinceTime(since: string, now: Date): string {
  const relative = /^(\d+)(s|m|h|d)$/.exec(since);
  if (relative) {
    const unit = relative[2];
    if (unit !== "s" && unit !== "m" && unit !== "h" && unit !== "d")
      throw new UsageError("Invalid time unit");
    const seconds = UNIT_SECONDS[unit];
    return new Date(now.getTime() - Number(relative[1]) * seconds * 1000).toISOString();
  }
  const absolute = ISO_TIME.test(since) ? new Date(since) : undefined;
  if (!absolute || Number.isNaN(absolute.getTime())) {
    throw new UsageError(`--since wants 30s, 10m, 2h, 1d or an ISO time, not ${since}`);
  }
  return absolute.toISOString();
}

function checkFilters(filters: Filters): void {
  if (filters.level && !(LEVELS as readonly string[]).includes(filters.level)) {
    throw new UsageError(`--level wants one of ${LEVELS.join(", ")}, not ${filters.level}`);
  }
  if (filters.source && filters.source !== "api" && filters.source !== "web") {
    throw new UsageError(`--source wants api or web, not ${filters.source}`);
  }
}

type Test = (record: LogRecord) => boolean;

/** One test per filter given; a record matches when it passes them all. */
export function matches(filters: Filters, now: Date): Test {
  checkFilters(filters);
  const { level, source, request, path, since, grep } = filters;
  const tests: Test[] = [];
  if (level) tests.push((r) => levelRank(r.level) >= levelRank(level));
  if (source) tests.push((r) => r.source === source);
  if (request) tests.push((r) => r.requestId === request);
  if (path) tests.push((r) => String(r.path ?? "").startsWith(path));
  if (since) {
    // A record without a time can't be placed in the window, so it is left out.
    const from = sinceTime(since, now);
    tests.push((r) => r.time !== "" && r.time >= from);
  }
  if (grep) {
    const text = grep.toLowerCase();
    tests.push((r) => JSON.stringify(r).toLowerCase().includes(text));
  }
  return (record) => tests.every((test) => test(record));
}

/** One record as a line: time, level, source, message, then the request summary or other fields. */
export function format(record: LogRecord): string {
  const { time, level, source, msg, ...fields } = record;
  const head = `${time} ${level.padEnd(5)} ${source.padEnd(3)} ${msg}`;
  if (msg === "request" && "method" in fields) {
    const { method, path, status, durationMs, requestId, ...rest } = fields;
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    return `${head} ${method} ${path} ${status} ${durationMs}ms id=${requestId}${extra}`;
  }
  return Object.keys(fields).length ? `${head} ${JSON.stringify(fields)}` : head;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      level: { type: "string" },
      source: { type: "string" },
      request: { type: "string" },
      path: { type: "string" },
      since: { type: "string" },
      grep: { type: "string" },
      tail: { type: "string" },
      prev: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  }).values;
}

/** --tail as a count (0 for all). Text output defaults to 100; --json, meant for jq, to all. */
function tailCount(tail: string | undefined, json: boolean): number {
  const count = Number(tail ?? (json ? "0" : "100"));
  if (!Number.isInteger(count) || count < 0) {
    throw new UsageError(`--tail wants a count, not ${tail}`);
  }
  return count;
}

function main(argv: string[]): number {
  const values = parse(argv);
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const tail = tailCount(values.tail, values.json);
  const all = sessionRecords(values.prev);
  if (all.length === 0) {
    console.error(
      values.prev
        ? "No previous run's logs in logs/."
        : "No dev logs yet. Start the servers with bun run dev:bg (or bun run dev).",
    );
    return 1;
  }
  const found = all.filter(matches(values, new Date()));
  const shown = tail === 0 ? found : found.slice(-tail);
  for (const record of shown) console.log(values.json ? JSON.stringify(record) : format(record));
  // On stderr, so it never mixes into --json output.
  if (shown.length < found.length) {
    console.error(`(last ${shown.length} of ${found.length} matching records; --tail 0 for all)`);
  }
  if (!values.json && found.length === 0) console.error("No records match.");
  return 0;
}

if (import.meta.main) {
  process.chdir(join(import.meta.dirname, ".."));
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    // A bad flag or value; anything else is a real failure and keeps its stack.
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
    if (!(error instanceof UsageError) && !code.startsWith("ERR_PARSE_ARGS")) throw error;
    console.error(
      `${error instanceof Error ? error.message : "Invalid arguments"}\nbun run logs --help lists the filters.`,
    );
    process.exitCode = 2;
  }
}
