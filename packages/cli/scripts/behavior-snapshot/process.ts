import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { humanPlan } from "../human";

export type Audience = "json" | "agent" | "human";

type Invocation = {
  node: string;
  binary: string;
  env: NodeJS.ProcessEnv & { HOME: string };
  args: ReadonlyArray<string>;
  audience: Audience;
  cwd: string;
  label: string;
};

function command({ node, binary, args, audience, env }: Invocation): {
  argv: string[];
  env: NodeJS.ProcessEnv;
  ptyPidFile?: string;
} {
  const direct = [node, binary];
  if (audience !== "human") {
    return { argv: [...direct, ...args, ...(audience === "json" ? ["--json"] : [])], env };
  }
  const ptyPidFile = join(env.HOME, "pty.pid");
  // Remember the CLI group inside script(1), which is separate from the wrapper's group.
  const pty = [
    "/bin/sh",
    "-c",
    'printf "%s\\n" "$$" > "$1" || exit; shift; exec "$@"',
    "snapshot-pty",
    ptyPidFile,
    ...direct,
  ];
  const terminal = process.platform === "linux" ? ["exec", ...pty] : pty;
  const plan = humanPlan({ command: terminal, args, platform: process.platform, env });
  if ("error" in plan) throw new Error(plan.error);
  return { ...plan, ptyPidFile };
}

function ptyPid(path: string | undefined) {
  if (path === undefined || !existsSync(path)) return undefined;
  const pid = Number(readFileSync(path, "utf8").trim());
  return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

function watchdog(child: ChildProcess, ptyPidFile: string | undefined) {
  let expired = false;
  let force: ReturnType<typeof setTimeout> | undefined;
  const killWrapper = () => {
    signalGroup(child.pid, "SIGKILL");
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  const deadline = setTimeout(() => {
    expired = true;
    signalGroup(ptyPid(ptyPidFile) ?? child.pid, "SIGTERM");
    // Give the CLI time to run its own finalizers, then close the wrapper and its terminal.
    force = setTimeout(() => {
      const pid = ptyPid(ptyPidFile);
      if (pid === undefined) {
        killWrapper();
        return;
      }
      signalGroup(pid, "SIGKILL");
      // Let script(1) reap its command before terminating an unresponsive wrapper.
      force = setTimeout(killWrapper, 1_000);
    }, 7_000);
  }, 30_000);
  return () => {
    clearTimeout(deadline);
    clearTimeout(force);
    return expired;
  };
}

export function runCommand(invocation: Invocation) {
  const { argv, env, ptyPidFile } = command(invocation);
  const [file, ...args] = argv;
  if (file === undefined) throw new Error("Missing snapshot executable");
  return new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: invocation.cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finishWatchdog = watchdog(child, ptyPidFile);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      finishWatchdog();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (finishWatchdog()) {
        reject(new Error(`${invocation.label} (${invocation.audience}) timed out after 30s`));
        return;
      }
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
