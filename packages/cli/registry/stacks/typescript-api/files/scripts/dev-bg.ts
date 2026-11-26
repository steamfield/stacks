#!/usr/bin/env bun
/**
 * Starts, reuses or stops this checkout's development session for noninteractive callers.
 * It coordinates the foreground wrapper through its PID record and waits for server readiness.
 */

// `bun run dev:bg` / `bun run dev:stop`: the dev server for agents and scripts, which can't
// sit in a foreground terminal.
//
//   start  Reuse the dev server already running from this checkout (yours or someone
//          else's) when it serves the requested PORT_API, or start scripts/dev.ts detached.
//          Returns once /healthz answers, and prints the URL. If the server doesn't come up,
//          or this script is interrupted while waiting, it stops what it started first.
//   stop   Stop the dev server running from this checkout, however it was started (the same
//          as Ctrl-C in its terminal), and return once its process groups are gone.
//
// Both find the server through logs/dev.pid, which scripts/dev.ts writes while it runs; a
// record whose start times no longer match (a reused pid) is ignored.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type DevServer,
  groupAlive,
  orphanedGroups,
  ownGroups,
  readPidFile,
  releasePidFile,
  runningDevServer,
} from "./dev-pid";
import { devStatus, unanswered } from "./dev-status";

process.chdir(join(import.meta.dirname, ".."));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ESRCH") return false;
    // It exists but belongs to another user.
    if (code === "EPERM") return true;
    throw error;
  }
}

const unhealthy = (port: string, deadline: number) =>
  unanswered(`http://localhost:${port}/healthz`, deadline);

// logs/dev.pid names pid: dev.ts writes it once it owns the port and logs/.
function ours(pid: number): boolean {
  return readPidFile()?.pid === pid;
}

// Poll /healthz while the server process lives. Only once the pid file is ours, so a server on
// the same port from another checkout can't pass for this one. Returns undefined once healthy,
// otherwise why it gave up.
async function waitHealthy({ pid, port }: DevServer, seconds: number): Promise<string | undefined> {
  const deadline = Date.now() + seconds * 1000;
  let reason = "logs/dev.pid never named the server";
  while (Date.now() < deadline) {
    if (!alive(pid)) return "the server process exited";
    if (ours(pid)) {
      const failure = await unhealthy(port, deadline);
      if (!failure) return undefined;
      reason = `last /healthz attempt: ${failure}`;
    }
    await sleep(500);
  }
  return reason;
}

async function waitUntil(gone: () => boolean, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline && !gone()) await sleep(500);
}

function tail(file: string, lines: number): string {
  if (!existsSync(file)) return "";
  return `${readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n")}\n`;
}

function ready({ pid, port }: DevServer): void {
  console.log(`Dev server running: http://localhost:${port} (pid ${pid})`);
  console.log(
    "Logs: bun run logs (--help for filters). Status: bun run dev:status. Stop: bun run dev:stop",
  );
}

async function reuse(running: DevServer): Promise<number> {
  // Reporting the recorded server as success would hand the caller a different URL than the one
  // it asked for.
  const requested = process.env.PORT_API;
  if (requested && requested !== running.port) {
    process.stderr.write(
      `A dev server from this checkout is running on port ${running.port}, not ${requested}; use it, or bun run dev:stop first.\n`,
    );
    return 1;
  }
  const failure = await waitHealthy(running, 60);
  if (!failure) {
    ready(running);
    return 0;
  }
  process.stderr.write(
    `A dev server is running (pid ${running.pid}, port ${running.port}) but /healthz doesn't answer (${failure}). Last lines of logs/dev.log:\n`,
  );
  process.stderr.write(tail("logs/dev.log", 30));
  return 1;
}

// Stops the dev.ts this invocation spawned, by its pid (never through a pid file that may name
// some other session), then the server groups its record names. dev.ts's exit handler sends
// SIGTERM to its server group; reaping waits for that group and kills it if dev.ts couldn't.
async function stopSpawned(pid: number): Promise<void> {
  const record = readPidFile();
  const groups = record?.pid === pid ? ownGroups(record) : [];
  signal(pid, "SIGTERM");
  await waitUntil(() => !alive(pid), 5);
  if (alive(pid)) signal(pid, "SIGKILL");
  await waitUntil(() => !alive(pid), 2);
  for (const pgid of groups) signal(-pgid, "SIGTERM");
  await reap(groups);
}

// While start waits, dev.ts and its server run outside the caller's process group, so a Ctrl-C
// or a tool's timeout signal reaches only this script. Stop what it spawned before exiting, or
// the server would hold the port with nothing waiting on it. Returns a function that removes
// the handlers.
function stopOnInterrupt(pid: number): () => void {
  let stopping = false;
  const handler = (sig: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    void stopSpawned(pid).finally(() => process.exit(128 + constants.signals[sig]));
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const sig of signals) process.on(sig, handler);
  return () => {
    for (const sig of signals) process.off(sig, handler);
  };
}

async function start(): Promise<number> {
  const running = runningDevServer();
  if (running) return reuse(running);
  const port = process.env.PORT_API || "3000";
  // The terminal copy lands in logs/dev.log; this file keeps only dev.ts's own complaints
  // (a refusal to start), overwritten on every start.
  mkdirSync("logs", { recursive: true });
  const out = "logs/dev-bg.err";
  const err = openSync(out, "w");
  // detached: its own session and process group, so `stop` can signal all of it and closing
  // this terminal doesn't hang it up.
  const child = spawn(process.execPath, ["scripts/dev.ts"], {
    detached: true,
    stdio: ["ignore", "ignore", err],
  });
  closeSync(err);
  child.unref();
  // A failed spawn throws above under bun; this only narrows the type.
  const pid = child.pid;
  if (pid === undefined) throw new Error("spawn returned no pid for scripts/dev.ts");
  const removeHandlers = stopOnInterrupt(pid);
  const failure = await waitHealthy({ pid, port }, 90);
  removeHandlers();
  if (!failure) {
    ready({ pid, port });
    return 0;
  }
  process.stderr.write(`The dev server didn't come up on port ${port} (${failure}). Its output:\n`);
  process.stderr.write(readFileSync(out, "utf8"));
  // Only this attempt's log: dev.ts exits before writing one when it refuses to start.
  if (existsSync("logs/dev.log") && statSync("logs/dev.log").mtimeMs > statSync(out).mtimeMs) {
    process.stderr.write(tail("logs/dev.log", 30));
  }
  await stopSpawned(pid);
  return 1;
}

function signal(target: number, sig: NodeJS.Signals): void {
  try {
    process.kill(target, sig);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    // Already gone between the check and the signal.
    if (code === "ESRCH") return;
    // Not ours to signal: report it and let the caller's wait decide the outcome.
    if (code === "EPERM") {
      console.error(
        `Not permitted to signal ${target < 0 ? "process group" : "pid"} ${Math.abs(target)}.`,
      );
      return;
    }
    throw error;
  }
}

// The groups have been sent SIGTERM. Give them 5 s, then SIGKILL what's left; returns the groups
// still alive after that.
async function reap(groups: number[]): Promise<number[]> {
  const left = () => groups.filter(groupAlive);
  await waitUntil(() => left().length === 0, 5);
  for (const pgid of left()) signal(-pgid, "SIGKILL");
  await waitUntil(() => left().length === 0, 2);
  return left();
}

// dev.ts was SIGKILLed (a tool timeout, say), so its exit handler never stopped the server. Its
// process group is named in the pid file, with a start time that still matches; stop it directly.
async function stopOrphans(groups: number[], say: (line: string) => void): Promise<number> {
  const record = readPidFile();
  for (const pgid of groups) signal(-pgid, "SIGTERM");
  const left = await reap(groups);
  if (left.length) {
    console.error(`The dev server's process group ${left.join(", ")} didn't exit.`);
    return 1;
  }
  if (record) releasePidFile(record.pid);
  say(
    `Stopped the dev server a killed dev session left running (process group ${groups.join(", ")}).`,
  );
  return 0;
}

async function stop(quiet = false): Promise<number> {
  const say = quiet ? () => {} : console.log;
  const running = runningDevServer();
  if (!running) {
    const orphans = orphanedGroups();
    if (orphans.length) return stopOrphans(orphans, say);
    say("No dev server is running from this checkout.");
    return 0;
  }
  const { pid, port } = running;
  // Read before dev.ts exits and removes the pid file.
  const groups = ownGroups(readPidFile());
  // SIGINT, like Ctrl-C: dev.ts passes it to the server, lets it shut down and finishes writing
  // logs/dev.log. Only dev.ts itself is signaled, never the group of whoever started it.
  signal(pid, "SIGINT");
  await waitUntil(() => !alive(pid), 10);
  if (alive(pid)) {
    signal(pid, "SIGTERM");
    await waitUntil(() => !alive(pid), 5);
  }
  if (alive(pid)) {
    console.error(`The dev server (pid ${pid}) didn't exit; port ${port} may still be taken.`);
    return 1;
  }
  // dev.ts's exit handler sends the server's group SIGTERM without waiting for it. The port is
  // free only once every recorded group is gone, so a caller can start a server right after.
  const left = await reap(groups);
  if (left.length) {
    console.error(
      `The dev server's process group ${left.join(", ")} didn't exit; port ${port} may still be taken.`,
    );
    return 1;
  }
  say(`Stopped the dev server on port ${port} (pid ${pid}).`);
  return 0;
}

const command = process.argv[2];
if (command === "start") {
  process.exitCode = await start();
} else if (command === "stop") {
  process.exitCode = await stop();
} else if (command === "status") {
  const report = await devStatus();
  for (const line of report.lines) console.log(line);
  process.exitCode = report.healthy ? 0 : 1;
} else {
  console.error("usage: scripts/dev-bg.ts start|stop|status");
  process.exitCode = 2;
}
