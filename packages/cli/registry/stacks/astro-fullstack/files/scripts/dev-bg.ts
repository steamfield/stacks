#!/usr/bin/env bun
/**
 * Starts, reuses or stops this checkout's development session for noninteractive callers.
 * It coordinates the foreground wrapper through its PID record and waits for server readiness.
 */

// `bun run dev:bg` / `bun run dev:stop`: the API and site dev servers for agents and scripts,
// which can't sit in a foreground terminal.
//
//   start  Reuse the dev servers already running from this checkout (yours or someone
//          else's), or start scripts/dev.ts detached. Returns once the API's /healthz and the
//          site's / answer, and prints both URLs. Exits 1 with the startup output if either
//          doesn't come up.
//   stop   Stop the dev servers running from this checkout, however they were started (the
//          same as Ctrl-C in their terminal).
//   status Whether they run, on which ports, whether each answers, and where the logs are
//          (scripts/dev-status.ts). Exits 0 only when both answer.
//
// All three find the server through logs/dev.pid, which scripts/dev.ts writes while it runs.
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

async function unhealthy({ api, web }: DevServer, deadline: number): Promise<string | undefined> {
  const apiFailure = await unanswered(`http://localhost:${api}/healthz`, deadline);
  if (apiFailure) return `API /healthz: ${apiFailure}`;
  const webFailure = await unanswered(`http://localhost:${web}/`, deadline);
  return webFailure && `site /: ${webFailure}`;
}

// logs/dev.pid names pid: dev.ts writes it once it owns the port and logs/.
function ours(pid: number): boolean {
  return readPidFile()?.pid === String(pid);
}

// Poll both servers while the dev process lives. Only once the pid file is ours, so a server on
// the same port from another checkout can't pass for this one. Returns undefined once healthy,
// otherwise why it gave up.
async function waitHealthy(server: DevServer, seconds: number): Promise<string | undefined> {
  const deadline = Date.now() + seconds * 1000;
  let reason = "logs/dev.pid never named the servers";
  while (Date.now() < deadline) {
    if (!alive(server.pid)) return "the dev process exited";
    if (ours(server.pid)) {
      const failure = await unhealthy(server, deadline);
      if (!failure) return undefined;
      reason = `last attempt: ${failure}`;
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

function ready({ pid, api, web }: DevServer): void {
  console.log(`API running: http://localhost:${api}`);
  console.log(`Site running: http://localhost:${web} (pid ${pid})`);
  console.log(
    "Logs: bun run logs (--help for filters). Status: bun run dev:status. Stop: bun run dev:stop",
  );
}

async function status(): Promise<number> {
  const report = await devStatus();
  for (const line of report.lines) console.log(line);
  return report.healthy ? 0 : 1;
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
      `Dev servers are running (pid ${running.pid}, API ${running.api}, site ${running.web}) but don't answer (${failure}). Last lines of logs/dev.log:\n`,
    );
    process.stderr.write(tail("logs/dev.log", 30));
    return 1;
  }
  const api = process.env.PORT_API || "3000";
  const web = process.env.PORT_WEB || "4321";
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
  const failure = await waitHealthy({ pid, api, web }, 90);
  if (!failure) {
    ready({ pid, api, web });
    return 0;
  }
  process.stderr.write(
    `The dev servers didn't come up on ports ${api} and ${web} (${failure}). Their output:\n`,
  );
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

// dev.ts was SIGKILLed (a tool timeout, say), so its exit handler never stopped the servers. Their
// process groups are named in the pid file; stop them directly.
async function stopOrphans(groups: number[], say: (line: string) => void): Promise<number> {
  for (const pgid of groups) signal(-pgid, "SIGTERM");
  await waitExit(() => orphanedGroups().length === 0, 5);
  for (const pgid of orphanedGroups()) signal(-pgid, "SIGKILL");
  await waitExit(() => orphanedGroups().length === 0, 2);
  const left = orphanedGroups();
  if (left.length) {
    console.error(`The dev servers' process groups ${left.join(", ")} didn't exit.`);
    return 1;
  }
  rmSync(PID_FILE, { force: true });
  say(
    `Stopped the dev servers a killed dev session left running (process groups ${groups.join(", ")}).`,
  );
  return 0;
}

async function stop(quiet = false): Promise<number> {
  const say = quiet ? () => {} : console.log;
  const running = runningDevServer();
  if (!running) {
    const orphans = orphanedGroups();
    if (orphans.length) return stopOrphans(orphans, say);
    say("No dev servers are running from this checkout.");
    return 0;
  }
  const { pid, api, web } = running;
  const port = `${api} and ${web}`;
  // SIGINT, like Ctrl-C: dev.ts passes it to the servers, lets them shut down and finishes
  // writing logs/dev.log. Only dev.ts itself is signaled, never the group of whoever started it.
  signal(pid, "SIGINT");
  await waitExit(() => !alive(pid), 10);
  if (alive(pid)) {
    signal(pid, "SIGTERM");
    await waitExit(() => !alive(pid), 5);
  }
  if (alive(pid)) {
    console.error(`The dev servers (pid ${pid}) didn't exit; ports ${port} may still be taken.`);
    return 1;
  }
  say(`Stopped the dev servers on ports ${port} (pid ${pid}).`);
  return 0;
}

const command = process.argv[2];
if (command === "start") {
  process.exitCode = await start();
} else if (command === "stop") {
  process.exitCode = await stop();
} else if (command === "status") {
  process.exitCode = await status();
} else {
  console.error("usage: scripts/dev-bg.ts start|stop|status");
  process.exitCode = 2;
}
