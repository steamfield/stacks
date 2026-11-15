#!/usr/bin/env bun
/**
 * Runs the API and Astro development servers together, saving their terminal output and structured logs.
 * It owns the session's PID record and log rotation, and stops both servers when either exits.
 */

// `bun run dev`: the API and the site's dev server, with everything they print (Node, Astro,
// startup errors, app logs) shown with an [api] or [web] prefix and also saved to logs/dev.log
// with colors stripped. The API separately writes structured JSON lines to logs/server.jsonl
// (LOG_FILE), and every other line either server prints becomes a JSON record in logs/dev.jsonl
// (scripts/dev-logs.ts; read both with `bun run logs`). Each start moves the previous run's files
// to logs/*.prev.* so a crash before a restart is still there to read. When either server exits,
// the other is stopped too.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
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
import { PID_FILE, runningDevServer } from "./dev-pid";

process.chdir(join(import.meta.dirname, ".."));

const api = process.env.PORT_API || "3000";
const web = process.env.PORT_WEB || "4321";

// Check before rotating, so a second `bun run dev` (on any port) can't move a running
// server's logs away.
const other = runningDevServer();
if (other) {
  console.error(
    `Dev servers from this checkout are already running (API ${other.api}, site ${other.web}, pid ${other.pid}). Their logs are in logs/; stop them with bun run dev:stop.`,
  );
  process.exit(1);
}
for (const [name, port, variable] of [
  ["API", api, "PORT_API"],
  ["site", web, "PORT_WEB"],
]) {
  // A missing lsof sets `error`; skip the check then.
  const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "ignore" });
  if (!lsof.error && lsof.status === 0) {
    console.error(
      `Port ${port} (the ${name}) is already in use by another process. Pick another with ${variable}=<port>, or run bun run dev:stop if a killed dev session left it running.`,
    );
    process.exit(1);
  }
}

mkdirSync("logs", { recursive: true });
for (const file of [TERMINAL_LOG, SERVER_LOG, OUTPUT_LOG]) {
  if (existsSync(file)) renameSync(file, previous(file));
}
writeFileSync(PID_FILE, `${process.pid} ${api} ${web}\n`);

// Each server runs detached, leading its own process group, so a signal reaches exactly that
// server and its children, never the shell or tool that started this script.
const groups: number[] = [];
function signalServers(sig: NodeJS.Signals): void {
  for (const pid of groups) {
    try {
      process.kill(-pid, sig);
    } catch (error) {
      // Already gone.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

// On any exit (an uncaught throw included), take both servers and their children down too, so a
// `kill` of this script alone can't leave a server holding a port with no pid file pointing at it.
// Registered only now, so a refusal above leaves the pid file.
process.on("exit", () => {
  rmSync(PID_FILE, { force: true });
  signalServers("SIGTERM");
});
// Ctrl-C reaches only this script (the servers are in their own groups), so pass it on. Keep
// copying their shutdown output, for at most 5 seconds.
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) return;
  interrupted = true;
  signalServers("SIGINT");
  setTimeout(() => process.exit(130), 5000).unref();
});
process.on("SIGTERM", () => process.exit(128 + constants.signals.SIGTERM));
process.on("SIGHUP", () => process.exit(128 + constants.signals.SIGHUP));

// stdout is a pipe for the servers, so keep colors on for the terminal (unless NO_COLOR is set).
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT_API: api,
  PORT_WEB: web,
  LOG_FILE: resolve(SERVER_LOG),
};
if (!env.NO_COLOR) env.FORCE_COLOR ||= "1";

process.stdout.write(
  `  \x1b[2mAPI http://localhost:${api}, site http://localhost:${web}. Logs: bun run logs (filters: --help), logs/dev.log (this terminal)\x1b[0m\n`,
);

// Appends to a log file that this start rotated, so it begins empty. Past MAX_LOG_BYTES it moves
// to logs/*.old.* and starts again, so a long session can't grow it without bound (and the
// session-start status, which scans the file, stays cheap).
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

// Each line goes to the terminal, and a copy without color codes is appended to logs/dev.log.
// Lines that aren't already API records also become records in logs/dev.jsonl.
// readline also ends a line at a lone \r, so a line redrawn with \r prints as separate lines.
const log = cappedAppender(TERMINAL_LOG);
const records = cappedAppender(OUTPUT_LOG);
const servers = [
  { name: "api", script: "dev:api" },
  { name: "web", script: "dev:web" },
] as const;
let open = servers.length;
for (const { name, script } of servers) {
  const child = spawn(process.execPath, ["run", script], {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid !== undefined) groups.push(child.pid);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
      process.stdout.write(`[${name}] ${line}\n`);
      const plain = stripVTControlCharacters(line);
      log(`[${name}] ${plain}\n`);
      const record = plain.trim() ? outputRecord(name, plain, new Date()) : undefined;
      if (record) records(`${JSON.stringify(record)}\n`);
    });
  }
  child.on("close", (code, signal) => {
    open -= 1;
    process.exitCode ??= code ?? 128 + (signal ? constants.signals[signal] : 0);
    // One server stopping on its own ends the session: a half-running stack would mislead. After
    // Ctrl-C, wait for both so their shutdown output lands; the exit handler cleans up.
    if (!interrupted || open === 0) process.exit();
  });
}
// Name the server groups too, so bun run dev:stop can still stop them if this script is killed
// with SIGKILL and its exit handler never runs.
writeFileSync(PID_FILE, `${process.pid} ${api} ${web} ${groups.join(" ")}\n`);
