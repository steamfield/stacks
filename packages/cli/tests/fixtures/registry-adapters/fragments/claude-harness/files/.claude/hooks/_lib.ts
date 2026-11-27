// Shared helpers for TypeScript hooks, run by Bun with the JSON payload on stdin.
// node: APIs only, so tsc checks these with the project's @types/node.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export type ToolInput = {
  command?: unknown;
  working_directory?: unknown;
  file_path?: unknown;
  content?: unknown;
  new_string?: unknown;
  edits?: unknown;
};
export type Payload = { cwd?: unknown; tool_input?: ToolInput };

/** The payload on stdin, or undefined when it is empty or not a JSON object. */
export function readPayload(): Payload | undefined {
  const text = readFileSync(0, "utf8");
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Payload)
      : undefined;
  } catch {
    // Not JSON: say nothing and let the tool call through, as a missing payload would.
    return undefined;
  }
}

/** A payload field as text: strings as they are, numbers and `true` printed, anything else empty. */
export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || value === true) return String(value);
  return "";
}

/** The text a Write (content), Edit (new_string), or legacy MultiEdit (edits[].new_string) adds. */
export function writtenText(input: ToolInput | undefined): string {
  const edits = Array.isArray(input?.edits) ? input.edits : [];
  return [
    input?.content,
    input?.new_string,
    ...edits.map((edit: unknown) =>
      typeof edit === "object" && edit !== null ? (edit as ToolInput).new_string : undefined,
    ),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

/** True when some line of `input` matches: grep's per-line semantics for ^, $, and classes. */
export function anyLine(re: RegExp, input: string): boolean {
  return input.split("\n").some((line) => re.test(line));
}

/** $CLAUDE_PROJECT_DIR when it names a directory (Claude Code always sets it), else the git top level, else the cwd. Not symlink-resolved. */
export function projectRoot(): string {
  const dir = process.env.CLAUDE_PROJECT_DIR;
  if (dir && isDir(dir)) return dir;
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return git.status === 0 ? git.stdout.trim() : process.cwd();
}

/** The nearest directory, walking up from `start`, containing any of `names` (which may be relative paths). */
export function findUp(start: string, ...names: string[]): string | undefined {
  let dir = start;
  for (;;) {
    if (names.some((name) => existsSync(join(dir, name)))) return dir;
    if (dir === "/" || dir === "") return undefined;
    dir = dirname(dir);
  }
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return isFile(path);
  } catch {
    return false;
  }
}

// Children of `run` get their own process groups (see run), so a hook that Claude Code kills (it
// times hooks out) takes them along here. A SIGKILL to the hook can't be caught and would leave
// them running until their own timeout.
const children = new Set<ChildProcess>();
for (const [signal, code] of [
  ["SIGTERM", 143],
  ["SIGINT", 130],
  ["SIGHUP", 129],
] as const) {
  process.on(signal, () => {
    for (const child of children) killGroup(child);
    process.exitCode = code;
    process.exit();
  });
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    // The group already exited.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/**
 * Run a command with stdout and stderr in one stream (a temp file, so their order is kept),
 * killing its whole process group after `timeoutSec`. The code is 124 on timeout and 127 when
 * the command can't be started.
 */
export async function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutSec: number },
): Promise<{ code: number; output: string }> {
  const dir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "claude-hook-"));
  const outFile = join(dir, "out");
  const fd = openSync(outFile, "w");
  try {
    const code = await new Promise<number>((resolve) => {
      // Its own process group, so a timeout also kills grandchildren (bunx, npx) instead of
      // leaving them running.
      const child = spawn(command, args, {
        cwd: options.cwd,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      children.add(child);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup(child);
      }, options.timeoutSec * 1000);
      child.on("error", () => {
        clearTimeout(timer);
        children.delete(child);
        resolve(127);
      });
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        children.delete(child);
        resolve(timedOut ? 124 : (exitCode ?? 1));
      });
    });
    return { code, output: readFileSync(outFile, "utf8") };
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Drop ANSI escapes and other control characters, keeping tabs, newlines, and carriage returns. */
export function stripControl(input: string): string {
  return [...stripVTControlCharacters(input)]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join("");
}

/** Deny the tool call, with the reason shown to the agent. */
export function deny(reason: string): void {
  write({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

/** Hand text back to the agent as context after a tool call. */
export function addContext(text: string): void {
  write({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } });
}

// Written once, and the process then ends on its own rather than through process.exit(), so a
// piped stdout is flushed: a cut-off deny would be read as plain text and the call would run.
function write(output: object): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
