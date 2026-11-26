/**
 * Reads the development wrapper's PID record and identifies live or orphaned server groups.
 * The foreground and background commands share it to track this checkout's processes.
 */

// logs/dev.pid holds "<pid> <port> <server group>" while scripts/dev.ts runs. Shared by dev.ts and
// dev-bg.ts; paths are relative to the repo root, which both scripts chdir to.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const PID_FILE = "logs/dev.pid";

export type DevServer = { pid: number; port: string };

type PidFile = { pid?: string; port?: string; groups: number[] };

/** The pid file's fields, or undefined when there's no pid file. */
export function readPidFile(): PidFile | undefined {
  try {
    const [pid, port, ...groups] = readFileSync(PID_FILE, "utf8").trim().split(/\s+/);
    return { pid, port, groups: groups.map(Number).filter((g) => g > 0) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** The dev server the pid file names, if it's a live scripts/dev.ts (not a stale pid reused by something else). */
export function runningDevServer(): DevServer | undefined {
  const { pid, port } = readPidFile() ?? {};
  if (!pid || !port) return undefined;
  const ps = spawnSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" });
  return ps.stdout.includes("scripts/dev.ts") ? { pid: Number(pid), port } : undefined;
}

/** Whether any process in the group is alive (EPERM: alive, owned by another user). */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Server process groups still running after scripts/dev.ts died without cleaning up (SIGKILL). */
export function orphanedGroups(): number[] {
  if (runningDevServer()) return [];
  return (readPidFile()?.groups ?? []).filter(groupAlive);
}
