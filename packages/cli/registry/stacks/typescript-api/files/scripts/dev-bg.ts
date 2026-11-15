#!/usr/bin/env bun
/**
 * Starts, reuses or stops this checkout's development session for noninteractive callers.
 * It coordinates the foreground wrapper through its PID record and waits for server readiness.
 */

// `bun run dev:bg` / `bun run dev:stop`: the dev server for agents and scripts, which can't
// sit in a foreground terminal.
//
//   start  Reuse the dev server already running from this checkout (yours or someone
//          else's), or start scripts/dev.ts detached. Returns once /healthz answers, and
//          prints the URL. Exits 1 with the startup output if the server doesn't come up.
//   stop   Stop the dev server running from this checkout, however it was started (the same
//          as Ctrl-C in its terminal).
//
// Both find the server through logs/dev.pid, which scripts/dev.ts writes while it runs.
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type DevServer, orphanedGroups, PID_FILE, readPidFile, runningDevServer } from "./dev-pid";
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
  return readPidFile()?.pid === String(pid);
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

async function waitExit(gone: () => boolean, seconds: number): Promise<void> {
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

async function start(): Promise<number> {
  const running = runningDevServer();
  if (running) {
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
  const failure = await waitHealthy({ pid, port }, 90);
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
  if (alive(pid)) await stop(true);
  return 1;
}

function signal(target: number, sig: NodeJS.Signals): void {
  try {
    process.kill(target, sig);
  } catch (error) {
    // Already gone between the check and the signal.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// dev.ts was SIGKILLed (a tool timeout, say), so its exit handler never stopped the server. Its
// process group is named in the pid file; stop it directly.
async function stopOrphans(groups: number[], say: (line: string) => void): Promise<number> {
  for (const pgid of groups) signal(-pgid, "SIGTERM");
  await waitExit(() => orphanedGroups().length === 0, 5);
  for (const pgid of orphanedGroups()) signal(-pgid, "SIGKILL");
  await waitExit(() => orphanedGroups().length === 0, 2);
  const left = orphanedGroups();
  if (left.length) {
    console.error(`The dev server's process group ${left.join(", ")} didn't exit.`);
    return 1;
  }
  rmSync(PID_FILE, { force: true });
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
  // SIGINT, like Ctrl-C: dev.ts passes it to the server, lets it shut down and finishes writing
  // logs/dev.log. Only dev.ts itself is signaled, never the group of whoever started it.
  signal(pid, "SIGINT");
  await waitExit(() => !alive(pid), 10);
  if (alive(pid)) {
    signal(pid, "SIGTERM");
    await waitExit(() => !alive(pid), 5);
  }
  if (alive(pid)) {
    console.error(`The dev server (pid ${pid}) didn't exit; port ${port} may still be taken.`);
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
