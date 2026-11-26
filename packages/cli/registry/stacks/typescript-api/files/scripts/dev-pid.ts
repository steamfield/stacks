/**
 * Owns the development wrapper's PID record and identifies live or orphaned server groups.
 * The foreground and background commands share it to track this checkout's processes.
 */

// logs/dev.pid is one JSON line while scripts/dev.ts runs: its pid, port and start time, and each
// server process group with its leader's start time. The file is gitignored and outlives crashes
// and reboots, and pids get reused, so a pid or group counts as ours only while `ps` reports the
// start time it was recorded with. Paths are relative to the repo root, which callers chdir to.
import { spawnSync } from "node:child_process";
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export const PID_FILE = "logs/dev.pid";

export type DevServer = { pid: number; port: string };

type Recorded = { pid: number; started: string };

export type PidRecord = Recorded & { port: string; groups: Recorded[] };

// One `ps` field for `pid`, or undefined when no such process runs. LC_ALL=C pins the date
// format, so a start time recorded from one shell matches when read from another with a different
// LANG.
function psField(field: string, pid: number): string | undefined {
  const ps = spawnSync("ps", ["-o", `${field}=`, "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  if (ps.error) {
    throw new Error(`The dev scripts need ps to identify their processes: ${ps.error.message}`);
  }
  return (ps.stdout ?? "").trim() || undefined;
}

/** When `pid` started, as `ps -o lstart=` prints it, or undefined when no such process runs. */
export function startedAt(pid: number): string | undefined {
  return psField("lstart", pid);
}

/** The process group `pid` belongs to, or undefined when no such process runs. */
export function processGroup(pid: number): number | undefined {
  const pgid = Number(psField("pgid", pid));
  return Number.isInteger(pgid) && pgid > 0 ? pgid : undefined;
}

/** Whether `pid` is still the process recorded with this start time. */
function same({ pid, started }: Recorded): boolean {
  return started !== "" && startedAt(pid) === started;
}

function isRecorded(value: unknown): value is Recorded {
  const { pid, started } = (value ?? {}) as Partial<Recorded>;
  return Number.isInteger(pid) && Number(pid) > 0 && typeof started === "string";
}

function isPidRecord(value: unknown): value is PidRecord {
  const { port, groups } = (value ?? {}) as Partial<PidRecord>;
  return (
    isRecorded(value) &&
    typeof port === "string" &&
    Array.isArray(groups) &&
    groups.every(isRecorded)
  );
}

/** The pid file's record; undefined when there is none or it can't be read as one (stale). */
export function readPidFile(): PidRecord | undefined {
  let text: string;
  try {
    text = readFileSync(PID_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const record: unknown = JSON.parse(text);
    return isPidRecord(record) ? record : undefined;
  } catch {
    return undefined;
  }
}

/** The dev server the pid file names, if that process still runs (not a reused pid). */
export function runningDevServer(): DevServer | undefined {
  const record = readPidFile();
  return record && same(record) ? { pid: record.pid, port: record.port } : undefined;
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

/** The recorded server groups whose leader is still the process that was recorded. */
export function ownGroups(record: PidRecord | undefined): number[] {
  return (record?.groups ?? []).filter(same).map((group) => group.pid);
}

/** Server process groups still running after scripts/dev.ts died without cleaning up (SIGKILL). */
export function orphanedGroups(): number[] {
  if (runningDevServer()) return [];
  return ownGroups(readPidFile());
}

const serialize = (record: PidRecord) => `${JSON.stringify(record)}\n`;

function readText(): string | undefined {
  try {
    return readFileSync(PID_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Creates the pid file for this process, or returns false when another record holds it. The
 * record is written to a temporary file and hard-linked into place, so the create is atomic and
 * exclusive: of two concurrent starts, one gets the file and the other gets false. A stale file
 * (unreadable, or naming processes that are gone) is removed first, and only if it still holds
 * the text that was judged stale.
 */
export function claimPidFile(record: PidRecord): boolean {
  const text = readText();
  if (text !== undefined) {
    const current = readPidFile();
    if (current && (same(current) || ownGroups(current).length > 0)) return false;
    if (readText() === text) rmSync(PID_FILE, { force: true });
  }
  const temporary = `${PID_FILE}.${record.pid}`;
  writeFileSync(temporary, serialize(record));
  try {
    linkSync(temporary, PID_FILE);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Replaces this process's record atomically, so a reader never sees a partial file. */
export function updatePidFile(record: PidRecord): void {
  const temporary = `${PID_FILE}.${record.pid}`;
  writeFileSync(temporary, serialize(record));
  renameSync(temporary, PID_FILE);
}

/** Removes the pid file only while it names `pid`, never a record another start wrote. */
export function releasePidFile(pid: number): void {
  if (readPidFile()?.pid === pid) rmSync(PID_FILE, { force: true });
}
