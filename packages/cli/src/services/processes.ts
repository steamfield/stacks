/**
 * The one way CLI code starts a child process. `stacks verify` runs its steps through it, `new`
 * launches the chosen coding agent with it, and git, `gh` and `npm` calls go through it too.
 *
 * Every command except `interactive` runs in its own process group (the child and everything it
 * starts, signaled together by one negative pid), with stdin closed and output kept in a bounded
 * buffer. Stopping a group is always SIGTERM, up to 5 s for it to exit, then SIGKILL. After a
 * command exits, its output pipes get 2 s to close; a grandchild still holding them then has its
 * group killed, and the result says so (`Finished.pipesHeld`). `interactive` is the exception: the
 * child joins the CLI's own group so the terminal and its Ctrl+C belong to it.
 *
 * Callers never touch Node's process APIs. Those live in `platform/process.ts`, which no other
 * core or services file may import (a Grit rule in `biome-plugins/boundaries.grit` enforces it). The live groups and
 * the interactive child are recorded in `Foreground`, a holder `bin.ts` shares with the signal
 * policy (`platform/signals.ts`), so a forced exit can SIGKILL whatever is still running.
 *
 * Start at the `Processes` service at the bottom; `processGroups` owns the group lifecycle.
 */
import {
  type Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  type PlatformError,
  Queue,
  type Scope,
  Stream,
} from "effect";
import { AppConfig } from "../config";
import { SpawnFailed } from "../errors";
import {
  type Child,
  type ChildExit,
  groupAlive,
  killGroup,
  killProcess,
  type ProcessHolder,
  type SpawnRequest,
  spawnChild,
} from "../platform/process";
import { NewestBytes } from "./newest-bytes";

/** Output kept per process (per stream for `exec`). No caller picks its own size. */
export const TAIL_BYTES = 256 * 1024;
/** Lines of kept output reported in `Finished.tail`. */
export const TAIL_LINES = 60;
/** SIGTERM to SIGKILL. */
const GRACE = Duration.seconds(5);
/** How long output may stay open after the command exits. */
const DRAIN = Duration.seconds(2);
/** How long to wait for a SIGKILLed group to disappear before giving up on it. */
const SETTLE = Duration.seconds(1);
/** How often a group is checked while waiting for it to disappear. */
const POLL = Duration.millis(20);
const PIPES_HELD =
  "stacks: output was still open 2s after the command exited; its process group was killed.";
/** Spawn errnos that mean the machine ran out of something, not that the command is wrong. */
const RESOURCE_ERRNOS = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"]);

type ShellSpec = {
  /** Run through `/bin/sh -c`. */
  command: string;
  cwd: string;
  /** The whole environment, from `AppConfig.childEnv`; nothing is inherited. */
  env: Record<string, string>;
  timeout?: Duration.Duration;
};
type ArgvSpec = {
  /** `argv[0]` is the program; no shell, no expansion. */
  argv: readonly [string, ...string[]];
  cwd: string;
  env: Record<string, string>;
  timeout?: Duration.Duration;
};
type InteractiveSpec = {
  bin: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};
export type Captured = {
  exitCode: number;
  signal?: string;
  durationMs: number;
  /** Kept separately, each capped at TAIL_BYTES (the newest bytes). */
  stdout: string;
  stderr: string;
  /** A cap was hit, or output was still open after the drain and the group was killed. */
  truncated: boolean;
  timedOut: boolean;
};
export type Finished = {
  /** 128 + n when killed by signal n. */
  exitCode: number;
  signal?: string;
  durationMs: number;
  /** The last TAIL_LINES lines of combined stdout and stderr. */
  tail: string;
  timedOut: boolean;
  /** Output was still open 2 s after the command exited; the group was killed. */
  pipesHeld: boolean;
};
interface Running {
  /** The process exited and its output closed. */
  readonly exited: Effect.Effect<Finished>;
  /** The last TAIL_LINES lines of output so far. */
  readonly tail: Effect.Effect<string>;
}
/** What `processGroups` needs to spawn a group leader; detaching and piping are fixed. */
type LaunchRequest = Pick<SpawnRequest, "file" | "args" | "cwd" | "env" | "onData">;

/** The per-invocation `ProcessHolder` (see platform/process.ts), provided by bin.ts. */
export class Foreground extends Context.Service<Foreground, ProcessHolder>()("stacks/Foreground") {
  static make = (): ProcessHolder => ({
    groups: new Set(),
    foreground: undefined,
    onForegroundCleared: undefined,
  });
  static layer = (holder: ProcessHolder) => Layer.succeed(Foreground, holder);
}

/** The last TAIL_LINES lines of kept output, with the pipes-held notice appended when it applies. */
function tailOf(output: NewestBytes, pipesHeld: boolean): string {
  let text = output.text();
  if (pipesHeld) text += `${text && !text.endsWith("\n") ? "\n" : ""}${PIPES_HELD}`;
  return text.replace(/\n$/, "").split("\n").slice(-TAIL_LINES).join("\n");
}

const exitFields = (exit: ChildExit) => ({
  exitCode: exit.code,
  ...(exit.signal ? { signal: exit.signal } : {}),
  durationMs: exit.durationMs,
});

/** The errno behind a failed `stat`, or the closest one its reason implies. */
function errnoOf(error: PlatformError.PlatformError): string {
  const cause = error.reason.cause;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
  )
    return cause.code;
  const tag = error.reason._tag;
  if (tag === "PermissionDenied") return "EACCES";
  if (tag === "BadResource") return "ENOTDIR";
  return "ENOENT";
}

/** Maps a spawn errno to `SpawnFailed`: `resources` when the machine is out of something. */
const spawnFailed =
  (fallback: "shell" | "command") =>
  ({ errno }: { errno: string }) =>
    new SpawnFailed({ kind: RESOURCE_ERRNOS.has(errno) ? "resources" : fallback, errno });

/** Fails `SpawnFailed` with kind `cwd` unless `cwd` is an existing directory. */
const checkCwd = (fs: FileSystem.FileSystem, cwd: string) =>
  fs.stat(cwd).pipe(
    Effect.mapError((error) => new SpawnFailed({ kind: "cwd", errno: errnoOf(error) })),
    Effect.flatMap((info) =>
      info.type === "Directory"
        ? Effect.void
        : Effect.fail(new SpawnFailed({ kind: "cwd", errno: "ENOTDIR" })),
    ),
  );

/** Whether the group was seen gone by `deadline` (epoch ms). */
const goneBy = (pid: number, deadline: number) =>
  Effect.gen(function* () {
    while (groupAlive(pid)) {
      if ((yield* Clock.currentTimeMillis) >= deadline) return false;
      yield* Effect.sleep(POLL);
    }
    return true;
  });

const shellRequest = (spec: ShellSpec, onData: LaunchRequest["onData"]): LaunchRequest => ({
  file: "/bin/sh",
  args: ["-c", spec.command],
  cwd: spec.cwd,
  env: spec.env,
  onData,
});

/** Delivers decoded chunks to `onOutput` in order, from a fiber owned by the scope. */
const deliver = (onOutput: (chunk: string) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    // Best-effort progress: under a slow reader, the oldest undelivered chunks are dropped.
    const queue = yield* Queue.sliding<string, Cause.Done>(1024);
    const fiber = yield* Effect.forkScoped(
      Stream.fromQueue(queue).pipe(Stream.runForEach(onOutput)),
    );
    return {
      offer: (chunk: string) => {
        if (chunk) Queue.offerUnsafe(queue, chunk);
      },
      finish: Queue.end(queue).pipe(Effect.andThen(Fiber.join(fiber))),
    };
  });

/**
 * The process groups this invocation started: launching them, stopping them and waiting for them
 * to finish. A group stays in `holder.groups` until it is seen gone, and only registered groups
 * are signaled, so a pid the OS has since reused is never hit.
 */
function processGroups(holder: ProcessHolder, fs: FileSystem.FileSystem) {
  /** When each registered group was sent SIGTERM; its SIGKILL is due GRACE after that. */
  const termSentAt = new Map<number, number>();
  /** The groups launched in each scope, so closing it can signal them together. */
  const byScope = new WeakMap<Scope.Scope, Set<number>>();

  const forget = (pid: number) => {
    holder.groups.delete(pid);
    termSentAt.delete(pid);
  };
  /** SIGTERM once per group, and only to a registered group that is still alive. */
  const sigterm = (pid: number) =>
    Effect.gen(function* () {
      if (!holder.groups.has(pid) || termSentAt.has(pid) || !groupAlive(pid)) return;
      killGroup(pid, "SIGTERM");
      termSentAt.set(pid, yield* Clock.currentTimeMillis);
    });
  /**
   * SIGTERM, up to 5 s, SIGKILL; the group leaves the registry once it is seen gone. `siblings`
   * (the other groups of a closing scope) get their SIGTERM now too, so a scope's groups share
   * one grace period instead of taking one each.
   */
  const terminate = (pid: number, siblings: Iterable<number> = []) =>
    Effect.gen(function* () {
      if (!holder.groups.has(pid)) return;
      for (const other of [pid, ...siblings]) yield* sigterm(other);
      const sent = termSentAt.get(pid);
      if (sent !== undefined && !(yield* goneBy(pid, sent + Duration.toMillis(GRACE)))) {
        killGroup(pid, "SIGKILL");
        const settled = (yield* Clock.currentTimeMillis) + Duration.toMillis(SETTLE);
        // A differently owned member answers EPERM forever; it stays registered.
        if (!(yield* goneBy(pid, settled))) return;
      }
      forget(pid);
    });
  /**
   * Spawns a detached group leader with piped output, registered until it is seen gone: by
   * the scope's release, or by a watcher once its output has closed and the group is empty.
   */
  const launchGroup = (
    request: LaunchRequest,
    fallback: "shell" | "command",
  ): Effect.Effect<Child, SpawnFailed, Scope.Scope> =>
    Effect.gen(function* () {
      yield* checkCwd(fs, request.cwd);
      const scope = yield* Effect.scope;
      const siblings = byScope.get(scope) ?? new Set<number>();
      byScope.set(scope, siblings);
      const child = yield* Effect.acquireRelease(
        spawnChild({ ...request, detached: true, stdio: "pipe" }).pipe(
          Effect.mapError(spawnFailed(fallback)),
          Effect.tap((child) =>
            Effect.sync(() => {
              holder.groups.add(child.pid);
              siblings.add(child.pid);
            }),
          ),
        ),
        (child) =>
          terminate(child.pid, siblings).pipe(
            Effect.ensuring(Effect.sync(() => siblings.delete(child.pid))),
          ),
      );
      yield* Effect.forkScoped(
        child.closed.pipe(
          Effect.andThen(goneBy(child.pid, Number.POSITIVE_INFINITY)),
          Effect.andThen(Effect.sync(() => forget(child.pid))),
        ),
      );
      return child;
    });
  /** Waits up to DRAIN for output to close; past that, SIGKILLs the group and reports true. */
  const drain = (child: Child) =>
    Effect.gen(function* () {
      const pipesHeld = Option.isNone(yield* Effect.timeoutOption(child.closed, DRAIN));
      if (pipesHeld) {
        if (holder.groups.has(child.pid)) killGroup(child.pid, "SIGKILL");
        yield* Effect.timeoutOption(child.closed, SETTLE);
      }
      return pipesHeld;
    });
  /** Waits for exit (stopping the group at the timeout), then drains output for up to 2 s. */
  const complete = (child: Child, timeout: Duration.Duration | undefined) =>
    Effect.gen(function* () {
      const exitedInTime =
        timeout === undefined
          ? Option.some(yield* child.exited)
          : yield* Effect.timeoutOption(child.exited, timeout);
      const timedOut = Option.isNone(exitedInTime);
      if (timedOut) yield* terminate(child.pid);
      const exit = Option.isSome(exitedInTime) ? exitedInTime.value : yield* child.exited;
      const pipesHeld = yield* drain(child);
      return { exit, timedOut, pipesHeld };
    });
  /** Whether `pid` is a registered group with a process still in it. */
  const isLive = (pid: number) => holder.groups.has(pid) && groupAlive(pid);

  return { launchGroup, terminate, complete, isLive };
}
type ProcessGroups = ReturnType<typeof processGroups>;

/** `Processes.run`: a shell command to completion, streaming decoded output to `onOutput`. */
const runShell = (
  groups: ProcessGroups,
  spec: ShellSpec,
  onOutput: ((chunk: string) => Effect.Effect<void>) | undefined,
): Effect.Effect<Finished, SpawnFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const output = new NewestBytes(TAIL_BYTES);
      const sink = onOutput ? yield* deliver(onOutput) : undefined;
      // One decoder per stream, so a character split across chunks decodes whole.
      const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
      const child = yield* groups.launchGroup(
        shellRequest(spec, (stream, chunk) => {
          output.push(chunk);
          sink?.offer(decoders[stream].decode(chunk, { stream: true }));
        }),
        "shell",
      );
      const { exit, timedOut, pipesHeld } = yield* groups.complete(child, spec.timeout);
      if (sink) {
        sink.offer(decoders.stdout.decode());
        sink.offer(decoders.stderr.decode());
        yield* sink.finish;
      }
      return { ...exitFields(exit), tail: tailOf(output, pipesHeld), timedOut, pipesHeld };
    }),
  );

/** `Processes.start`: a long-running shell command that the caller's scope stops. */
const startShell = (
  groups: ProcessGroups,
  spec: ShellSpec,
): Effect.Effect<Running, SpawnFailed, Scope.Scope> =>
  Effect.gen(function* () {
    const output = new NewestBytes(TAIL_BYTES);
    const child = yield* groups.launchGroup(
      shellRequest(spec, (_, chunk) => output.push(chunk)),
      "shell",
    );
    let timedOut = false;
    const { timeout } = spec;
    if (timeout)
      yield* Effect.forkScoped(
        Effect.sleep(timeout).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              // The whole group: a grandchild may outlive the shell and hold the output.
              if (!groups.isLive(child.pid)) return Effect.void;
              timedOut = true;
              return groups.terminate(child.pid);
            }),
          ),
        ),
      );
    return {
      exited: Effect.gen(function* () {
        const exit = yield* child.exited;
        yield* child.closed;
        return { ...exitFields(exit), tail: tailOf(output, false), timedOut, pipesHeld: false };
      }),
      tail: Effect.sync(() => tailOf(output, false)),
    };
  });

/** `Processes.exec`: a program on argv to completion, each stream kept separately. */
const execArgv = (groups: ProcessGroups, spec: ArgvSpec): Effect.Effect<Captured, SpawnFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const kept = { stdout: new NewestBytes(TAIL_BYTES), stderr: new NewestBytes(TAIL_BYTES) };
      const [file, ...args] = spec.argv;
      const child = yield* groups.launchGroup(
        {
          file,
          args,
          cwd: spec.cwd,
          env: spec.env,
          onData: (stream, chunk) => kept[stream].push(chunk),
        },
        "command",
      );
      const { exit, timedOut, pipesHeld } = yield* groups.complete(child, spec.timeout);
      return {
        ...exitFields(exit),
        stdout: kept.stdout.text(),
        stderr: kept.stderr.text(),
        truncated: kept.stdout.truncated || kept.stderr.truncated || pipesHeld,
        timedOut,
      };
    }),
  );

/**
 * Stops an interactive child still running (SIGTERM, up to 5 s, SIGKILL) and gives the terminal
 * back to the CLI.
 */
const releaseInteractive = (holder: ProcessHolder, child: Child) =>
  Effect.gen(function* () {
    if (child.running()) {
      killProcess(child.pid, "SIGTERM");
      if (Option.isNone(yield* Effect.timeoutOption(child.exited, GRACE))) {
        killProcess(child.pid, "SIGKILL");
        yield* Effect.timeoutOption(child.exited, SETTLE);
      }
    }
    // The terminal is the CLI's again; the signal policy may now act on a SIGTERM or SIGHUP it
    // forwarded to the child.
    holder.foreground = undefined;
    holder.onForegroundCleared?.();
  });

/** `Processes.interactive`: a program holding the terminal until it exits. */
const runInteractive = (
  holder: ProcessHolder,
  fs: FileSystem.FileSystem,
  spec: InteractiveSpec,
): Effect.Effect<number, SpawnFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* checkCwd(fs, spec.cwd);
      // Not detached: the child joins the CLI's process group, the terminal's foreground group,
      // so the terminal's Ctrl+C reaches it and it can read the TTY.
      const child = yield* Effect.acquireRelease(
        spawnChild({
          file: spec.bin,
          args: spec.args,
          cwd: spec.cwd,
          env: spec.env,
          detached: false,
          stdio: "inherit",
        }).pipe(
          Effect.mapError(spawnFailed("command")),
          Effect.tap((child) =>
            Effect.sync(() => {
              holder.foreground = child.pid;
            }),
          ),
        ),
        (child) => releaseInteractive(holder, child),
      );
      return (yield* child.exited).code;
    }),
  );

/** Where `which` looks: `name` itself when it has a slash, else each nonempty PATH entry. */
function pathCandidates(path: Path.Path, name: string, searchPath: string): string[] {
  if (name.includes("/")) return [name];
  return searchPath
    .split(":")
    .filter((dir) => dir !== "")
    .map((dir) => path.join(dir, name));
}

/** `Processes.which`: the first candidate that is a regular file with an execute bit. */
const findOnPath = (fs: FileSystem.FileSystem, candidates: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const candidate of candidates) {
      const info = yield* Effect.option(fs.stat(candidate));
      if (Option.isSome(info) && info.value.type === "File" && info.value.mode & 0o111)
        return Option.some(candidate);
    }
    return Option.none<string>();
  });

export class Processes extends Context.Service<
  Processes,
  {
    /** Runs a shell command in its own process group, with stdin closed. */
    run(
      spec: ShellSpec,
      onOutput?: (chunk: string) => Effect.Effect<void>,
    ): Effect.Effect<Finished, SpawnFailed>;
    /** Starts a long-running shell command whose process group ends when the scope closes. */
    start(spec: ShellSpec): Effect.Effect<Running, SpawnFailed, Scope.Scope>;
    /** Runs argv directly, with no shell; the only way to run a program on user-supplied values. */
    exec(spec: ArgvSpec): Effect.Effect<Captured, SpawnFailed>;
    /** Runs a program in the CLI's own process group with the terminal; returns its exit code. */
    interactive(spec: InteractiveSpec): Effect.Effect<number, SpawnFailed>;
    /** The first executable regular file named `name` on the captured PATH. */
    which(name: string): Effect.Effect<Option.Option<string>>;
  }
>()("stacks/Processes") {
  static layer = Layer.effect(
    Processes,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* AppConfig;
      const holder = yield* Foreground;
      const groups = processGroups(holder, fs);
      return {
        run: (spec, onOutput) => runShell(groups, spec, onOutput),
        start: (spec) => startShell(groups, spec),
        exec: (spec) => execArgv(groups, spec),
        interactive: (spec) => runInteractive(holder, fs, spec),
        which: (name) =>
          Effect.suspend(() =>
            findOnPath(fs, pathCandidates(path, name, config.childEnv([]).PATH ?? "")),
          ),
      };
    }),
  );
}
