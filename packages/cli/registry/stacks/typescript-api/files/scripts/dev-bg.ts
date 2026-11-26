#!/usr/bin/env bun
/**
 * Starts, reuses or stops this checkout's development session for noninteractive callers.
 * It coordinates the foreground wrapper through its PID record and waits for server readiness.
 */

// `bun run dev:bg` / `bun run dev:stop`: the dev server for agents and scripts, which can't
// sit in a foreground terminal.
//
//   start   Reuse the dev server already running from this checkout (a foreground `bun run dev`
//           included) when it answers on the requested PORT_API, or start scripts/dev.ts
//           detached. Returns once /healthz answers, and prints the URL. If the server doesn't
//           come up, or this script is interrupted while waiting (exit 130), it stops what it
//           started first.
//   stop    Stop the dev server running from this checkout, however it was started, by sending
//           its process groups SIGINT, and return once they are gone.
//   status  Report it; exit 0 while a recorded server runs, 1 otherwise.
//
// Both find the server through logs/dev.pid, which scripts/dev.ts writes while it runs; a
// record whose start times no longer match (a reused pid) is ignored.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type DevServer,
  groupAlive,
  orphanedGroups,
  ownGroups,
  processGroup,
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
    if (interrupted !== undefined) return "interrupted";
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

// Reuses the recorded server only when it serves the requested (or default) port and answers
// now. Anything else fails at once: reporting it as success would hand the caller a URL it didn't
// ask for, or one that doesn't work.
async function reuse(running: DevServer): Promise<number> {
  const requested = process.env.PORT_API || "3000";
  if (requested !== running.port) {
    process.stderr.write(
      `A dev server from this checkout is running on port ${running.port}, not ${requested}; use it, or stop it with bun run dev:stop.\n`,
    );
    return 1;
  }
  const failure = await unhealthy(running.port, Date.now() + 2000);
  if (!failure) {
    ready(running);
    return 0;
  }
  process.stderr.write(
    `A dev server from this checkout is running (pid ${running.pid}, port ${running.port}) but /healthz doesn't answer (${failure}); stop it with bun run dev:stop. Last lines of logs/dev.log:\n`,
  );
  process.stderr.write(tail("logs/dev.log", 30));
  return 1;
}

// Stops what this invocation spawned: the server groups the record names (only when the record
// is this spawn's, never another session's) and dev.ts's own group. dev.ts was spawned detached,
// so it leads that group alone.
async function stopSpawned(pid: number): Promise<void> {
  const record = readPidFile();
  const groups = record?.pid === pid ? ownGroups(record) : [];
  for (const pgid of groups) signal(-pgid, "SIGTERM");
  signal(-pid, "SIGTERM");
  await reap([...groups, pid]);
  releasePidFile(pid);
}

// Set when start is interrupted: resolves to the exit status (130) once what it spawned is stopped.
let interrupted: Promise<number> | undefined;

// While start waits, dev.ts and its server run outside the caller's process group, so a Ctrl-C
// or a tool's timeout signal reaches only this script. Stop what it spawned before exiting, or
// the server would hold the port with nothing waiting on it. The handlers stay installed once
// one fires, so a second signal can't cut the stop short. Returns a function that removes them.
function stopOnInterrupt(pid: number): () => void {
  const handler = () => {
    interrupted ??= stopSpawned(pid).then(() => 130);
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const sig of signals) process.on(sig, handler);
  return () => {
    if (interrupted !== undefined) return;
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
  if (interrupted !== undefined) {
    const status = await interrupted;
    process.stderr.write("Interrupted; stopped the dev server this start launched.\n");
    return status;
  }
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
  // SIGINT, like Ctrl-C, to the server's process groups, never to dev.ts's pid or the group of
  // whoever started it. dev.ts sees the server close, finishes writing logs/dev.log and exits. The
  // port is free only once every group is gone, so a caller can start a server right after.
  for (const pgid of groups) signal(-pgid, "SIGINT");
  await waitUntil(() => !groups.some(groupAlive), 10);
  for (const pgid of groups.filter(groupAlive)) signal(-pgid, "SIGTERM");
  const left = await reap(groups);
  if (left.length) {
    console.error(
      `The dev server's process group ${left.join(", ")} didn't exit; port ${port} may still be taken.`,
    );
    return 1;
  }
  if (!(await wrapperGone(pid))) {
    console.error(`The dev wrapper (pid ${pid}) didn't exit after its server stopped.`);
    return 1;
  }
  releasePidFile(pid);
  say(`Stopped the dev server on port ${port} (pid ${pid}).`);
  return 0;
}

// dev.ts exits once its server closes. If it hasn't (or it hadn't started the server yet), signal
// its group, but only when dev:bg started it as that group's leader: a foreground `bun run dev`
// shares its terminal's group. "Runs" means the record still names it with its start time, so a
// reused pid is never signaled.
async function wrapperGone(pid: number): Promise<boolean> {
  const runs = () => runningDevServer()?.pid === pid;
  await waitUntil(() => !runs(), 5);
  if (runs() && processGroup(pid) === pid) {
    signal(-pid, "SIGTERM");
    await reap([pid]);
  }
  return !runs();
}

const command = process.argv[2];
if (command === "start") {
  process.exitCode = await start();
} else if (command === "stop") {
  process.exitCode = await stop();
} else if (command === "status") {
  const report = await devStatus();
  for (const line of report.lines) console.log(line);
  process.exitCode = report.state === "running" ? 0 : 1;
} else {
  console.error("usage: scripts/dev-bg.ts start|stop|status");
  process.exitCode = 2;
}
