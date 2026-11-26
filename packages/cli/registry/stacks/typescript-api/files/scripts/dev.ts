#!/usr/bin/env bun
/**
 * Runs the API in the foreground and saves terminal output alongside structured development logs.
 * It owns the session's PID record, log rotation and server shutdown.
 */

// `bun run dev`: the dev server, with everything it prints (Node, startup errors, app logs)
// also saved to logs/dev.log with colors stripped. The app separately writes
// structured JSON lines to logs/server.jsonl. Each start moves the previous run's files
// to logs/*.prev.* so a crash before a restart is still there to read.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { constants } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";
import {
  MAX_LOG_BYTES,
  OUTPUT_LOG,
  older,
  outputRecord,
  previous,
  SERVER_LOG,
  TERMINAL_LOG,
} from "./dev-logs";
import {
  claimPidFile,
  orphanedGroups,
  type PidRecord,
  releasePidFile,
  runningDevServer,
  startedAt,
  updatePidFile,
} from "./dev-pid";

process.chdir(join(import.meta.dirname, ".."));

const port = process.env.PORT_API || "3000";

function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

// Check before rotating, so a second `bun run dev` (on any port) can't move a running
// server's logs away.
const other = runningDevServer();
if (other) {
  refuse(
    `A dev server from this checkout is already running on port ${other.port} (pid ${other.pid}). Its logs are in logs/; stop it with bun run dev:stop.`,
  );
}
if (orphanedGroups().length > 0) {
  refuse(
    "A killed dev session left its server running. Stop it with bun run dev:stop, then start again.",
  );
}
const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "ignore" });
if (lsof.error) {
  refuse(`The dev scripts need lsof to check that port ${port} is free: ${lsof.error.message}`);
}
if (lsof.status === 0) {
  refuse(
    `Port ${port} is already in use by another process. Pick another with PORT_API=<port>, or run bun run dev:stop if a killed dev session left it running.`,
  );
}

mkdirSync("logs", { recursive: true });
const record: PidRecord = {
  pid: process.pid,
  port,
  started: startedAt(process.pid) ?? "",
  groups: [],
};
// Exclusive: of two starts racing past the checks above, only one gets the record.
if (!claimPidFile(record)) {
  refuse("Another dev server from this checkout is starting. Check it with bun run dev:status.");
}
for (const file of [TERMINAL_LOG, SERVER_LOG, OUTPUT_LOG]) {
  if (existsSync(file)) renameSync(file, previous(file));
}

// The server runs detached, leading its own process group, so a signal reaches exactly the server
// and its children, never the shell or tool that started this script.
let group: number | undefined;
function signalServer(sig: NodeJS.Signals): void {
  if (group === undefined) return;
  try {
    process.kill(-group, sig);
  } catch (error) {
    // Already gone.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// On any exit (an uncaught throw included), take the server and its children down too, so a
// `kill` of this script alone can't leave Node holding the port with no pid file pointing at it.
// Registered only now, so a refusal above leaves the pid file alone, and the file is removed only
// while it still names this process.
process.on("exit", () => {
  releasePidFile(process.pid);
  signalServer("SIGTERM");
});
// Ctrl-C reaches only this script (the server is in its own group), so pass it on. Keep copying
// its shutdown output, for at most 5 seconds.
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) return;
  interrupted = true;
  signalServer("SIGINT");
  setTimeout(() => process.exit(130), 5000).unref();
});
process.on("SIGTERM", () => process.exit(128 + constants.signals.SIGTERM));
process.on("SIGHUP", () => process.exit(128 + constants.signals.SIGHUP));

// stdout is a pipe for the server, so keep colors on for the terminal (unless NO_COLOR is set).
const env: NodeJS.ProcessEnv = { ...process.env, PORT_API: port, LOG_FILE: resolve(SERVER_LOG) };
if (!env.NO_COLOR) env.FORCE_COLOR ||= "1";

process.stdout.write(
  "  \x1b[2mLogs: logs/dev.log (this terminal), logs/server.jsonl (JSON lines)\x1b[0m\n",
);

// Each line goes to the terminal, and a copy without color codes is appended to logs/dev.log.
// readline also ends a line at a lone \r, so a line redrawn with \r prints as separate lines.
function cappedAppender(file: string): (text: string) => void {
  let fd = openSync(file, "a");
  let size = 0;
  return (text) => {
    size += writeSync(fd, text);
    if (size <= MAX_LOG_BYTES) return;
    closeSync(fd);
    renameSync(file, older(file));
    fd = openSync(file, "a");
    size = 0;
  };
}

const log = cappedAppender(TERMINAL_LOG);
const records = cappedAppender(OUTPUT_LOG);
const server = spawn(process.execPath, ["run", "dev:server"], {
  env,
  detached: true,
  stdio: ["inherit", "pipe", "pipe"],
});
group = server.pid;
// Name the server's group too, so bun run dev:stop can still stop it if this script is killed
// with SIGKILL and its exit handler never runs.
const groupStarted = group === undefined ? undefined : startedAt(group);
if (group !== undefined && groupStarted !== undefined) {
  updatePidFile({ ...record, groups: [{ pid: group, started: groupStarted }] });
}
for (const stream of [server.stdout, server.stderr]) {
  createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
    process.stdout.write(`${line}\n`);
    const plain = stripVTControlCharacters(line);
    log(`${plain}\n`);
    const record = plain.trim() ? outputRecord("api", plain, new Date()) : undefined;
    if (record) records(`${JSON.stringify(record)}\n`);
  });
}
// Let the process end on its own, so pending stdout writes finish; the exit handler cleans up.
server.on("close", (code, signal) => {
  process.exitCode = code ?? 128 + (signal ? constants.signals[signal] : 0);
});
