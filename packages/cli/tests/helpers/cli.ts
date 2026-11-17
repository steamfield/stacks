import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { INDEX_PUBLIC_KEYS } from "@steamfield/stacks-format";
import { Clock, Effect, type Exit, Layer, Option, type Scope, Terminal } from "effect";
import type { HttpClient } from "effect/http";
import { hasFlag } from "../../src/argv";
import { type Build, SOURCE_BUILD } from "../../src/build";
import { AppConfig, type Environment } from "../../src/config";
import { Allowlist } from "../../src/core/allowlist";
import { main } from "../../src/main";
import { NetLayer } from "../../src/platform/net";
import { stringWidth } from "../../src/platform/width";
import { AppLayer, runInvocation } from "../../src/runtime";
import { Host, type HostInfo } from "../../src/services/host";
import { Output, type Writer } from "../../src/services/output";
import { Foreground, Processes } from "../../src/services/processes";

/** The package's authoring guide, which bin.ts resolves beside the registry. */
const guide = join(import.meta.dirname, "..", "..", "docs", "authoring.md");
export function tempDir() {
  const path = mkdtempSync(join(tmpdir(), "cli-base-"));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}
const children = new Map<ChildProcess, { closed: Promise<void>; detached: boolean }>();
/** Track process exit and stdio closure; detached children also own their process group. */
export function trackChild(child: ChildProcess, detached = false) {
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => {
      children.delete(child);
      resolve();
    });
  });
  children.set(child, { closed, detached });
}
/** A timed-out test can leave its awaited promise running; reap children before deleting HOME. */
export async function stopChildren() {
  await Promise.all(
    [...children].map(async ([child, { closed, detached }]) => {
      if (child.pid !== undefined) {
        try {
          process.kill(detached ? -child.pid : child.pid, "SIGKILL");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
      }
      await closed;
    }),
  );
}
/** A terminal on stdout: with no agent marker in `env`, the invocation's audience is human. */
export const terminal = { stdoutIsTTY: true } as const;
/** No log records, so a human-mode failure's stderr is only its message and detail lines. */
export const quiet = { LOG_LEVEL: "none" };
export function ndjson(text: string): unknown[] {
  return text.trim()
    ? text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown)
    : [];
}
/** A fresh script per invocation; an exhausted queue behaves like terminal EOF. */
export function scriptedTerminal(
  answers: ReadonlyArray<string | Effect.Effect<string, Terminal.QuitError>> = [],
) {
  const displayed: string[] = [];
  return { answers: [...answers], displayed, reads: 0 };
}
export async function runCli(
  args: readonly string[],
  options: {
    env?: Environment;
    releaseBuild?: boolean;
    apiUrl?: string;
    build?: Partial<Pick<Build, "officialIndexUrl" | "officialTelemetryUrl">>;
    allowlistKeys?: typeof INDEX_PUBLIC_KEYS;
    clock?: Clock.Clock;
    http?: Layer.Layer<HttpClient.HttpClient>;
    home?: string;
    program?: Parameters<typeof main>[0]["program"];
    signal?: AbortSignal;
    /** Overrides for the Host fixture, such as the TTY flags. */
    host?: Partial<HostInfo>;
    /** Runs before each write is captured; a rejection fails that write as the real stream would. */
    stdout?: Writer;
    stderr?: Writer;
    terminal?: ReturnType<typeof scriptedTerminal>;
  } = {},
) {
  const temp = options.home ? undefined : tempDir();
  const home = options.home ?? temp?.path ?? "/invalid";
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, "config"), NO_COLOR: "1", ...options.env };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const capture =
    (into: string[], gate?: Writer): Writer =>
    async (text) => {
      await gate?.(text);
      into.push(text);
    };
  const output = Output.layer({
    jsonFlag: hasFlag(args, "--json"),
    stdout: capture(stdout, options.stdout),
    stderr: capture(stderr, options.stderr),
  });
  const script = options.terminal ?? scriptedTerminal();
  const terminal = Layer.effect(
    Terminal.Terminal,
    Effect.map(Terminal.Terminal, (live) =>
      Terminal.make({
        ...live,
        readLine: Effect.suspend(() => {
          script.reads++;
          const answer = script.answers.shift();
          if (answer === undefined) return Effect.fail(new Terminal.QuitError());
          return typeof answer === "string" ? Effect.succeed(answer) : answer;
        }),
        display: (text) =>
          Effect.promise(async () => {
            await capture(stdout, options.stdout)(text);
            script.displayed.push(text);
          }),
      }),
    ),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  const platform = Layer.mergeAll(
    terminal,
    Host.memory({
      nodeMajor: Number(process.versions.node.split(".")[0]),
      platform: "test-node",
      cwd: home,
      packageRoot: join(import.meta.dirname, "..", ".."),
      authoring: guide,
      columns: Option.none(),
      stringWidth,
      ...options.host,
    }),
    Foreground.layer(Foreground.make()),
    Layer.merge(NetLayer, options.http ?? Layer.empty),
  );
  try {
    // A release build's API URL is the one bin passes in; tests pass theirs the same way.
    const application = AppLayer({
      output,
      env,
      build: {
        ...SOURCE_BUILD,
        releaseBuild: options.releaseBuild ?? SOURCE_BUILD.releaseBuild,
        officialApiUrl: options.apiUrl,
        ...options.build,
      },
    });
    const allowlist = Allowlist.layer({ keys: options.allowlistKeys ?? INDEX_PUBLIC_KEYS }).pipe(
      Layer.provide(application),
    );
    const status = await runInvocation(
      main({ args, program: options.program }).pipe(
        Effect.provide(Layer.provideMerge(Layer.merge(application, allowlist), platform)),
        Effect.scoped,
        (program) =>
          options.clock ? Effect.provideService(program, Clock.Clock, options.clock) : program,
      ),
      options.signal,
    );
    return { status, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    temp?.cleanup();
  }
}
/** A write error as Node reports it, with its errno code. */
export function writeError(code: "EPIPE" | "EACCES") {
  return Object.assign(new Error(code), { code });
}
/**
 * Runs `program` against the live Processes layer: real child processes, the real filesystem, and
 * an AppConfig that captured only `env` (by default just this machine's PATH).
 */
export function runProcesses<A, E>(
  program: Effect.Effect<A, E, Processes | AppConfig | Foreground | Scope.Scope>,
  env: Environment = { PATH: process.env.PATH },
): Promise<Exit.Exit<A, E>> {
  const deps = Layer.mergeAll(AppConfig.memory(env), Foreground.layer(Foreground.make()));
  const layer = Processes.layer.pipe(
    Layer.provideMerge(deps),
    Layer.provideMerge(NodeServices.layer),
  );
  return Effect.runPromiseExit(program.pipe(Effect.scoped, Effect.provide(layer)));
}
/**
 * `kill(pid, 0)` liveness, for a process or (with a negative pid) a process group: success or
 * EPERM is alive (a macOS zombie member answers EPERM), ESRCH is gone.
 */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
