import { Context, Effect, Layer, type PlatformError, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import { McpConfig } from "./config";
import { CliFailure } from "./errors";

export interface CliOutput {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOptions {
  readonly cwd?: string;
  readonly onStderrLine?: (line: string) => Effect.Effect<void>;
}

const collectStderr = Effect.fn("run.collectStderr")(function* (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  onLine: RunOptions["onStderrLine"],
) {
  let stderr = "";
  const text = stream.pipe(
    Stream.decodeText(),
    Stream.tap((chunk) =>
      Effect.sync(() => {
        stderr += chunk;
      }),
    ),
  );
  yield* text.pipe(
    Stream.splitLines,
    Stream.runForEach((line) => (onLine === undefined ? Effect.void : onLine(line))),
  );
  return stderr;
});

function systemMessage(error: PlatformError.PlatformError): string {
  const cause = error.reason.cause;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String(cause.code)
      : error.reason._tag;
  return `${code}: ${error.message}`;
}

export class CliRunner extends Context.Service<
  CliRunner,
  {
    readonly run: (
      args: ReadonlyArray<string>,
      options?: RunOptions,
    ) => Effect.Effect<CliOutput, CliFailure>;
  }
>()("stacks-mcp/CliRunner") {
  static readonly layer = Layer.effect(
    CliRunner,
    Effect.gen(function* () {
      const config = yield* McpConfig;
      const spawner = yield* ChildProcessSpawner;
      const run = Effect.fn("CliRunner.run")(function* (
        args: ReadonlyArray<string>,
        options?: RunOptions,
      ) {
        const command = ChildProcess.make(config.node, [config.cliEntry, ...args], {
          extendEnv: false,
          env: config.env,
          stdin: "ignore",
          killSignal: "SIGTERM",
          forceKillAfter: "15 seconds",
          ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        });
        return yield* Effect.gen(function* () {
          const child = yield* spawner.spawn(command);
          const [stdout, stderr, exit] = yield* Effect.all(
            [
              child.stdout.pipe(
                Stream.decodeText(),
                Stream.runFold(
                  () => "",
                  (text, chunk) => text + chunk,
                ),
              ),
              collectStderr(child.stderr, options?.onStderrLine),
              child.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          return { stdout, stderr, exit: Number(exit) };
        }).pipe(
          Effect.scoped,
          Effect.mapError(
            (error) =>
              new CliFailure({
                tag: "CliUnavailable",
                cliMessage: `Cannot run ${config.node} ${config.cliEntry}: ${systemMessage(error)}`,
                next: `Check or restore the server's Node executable at ${config.node}, then restart the server. For a CLI entry problem, set STACKS_MCP_CLI to @steamfield/stacks's dist/stacks entry or reinstall @steamfield/stacks.`,
                retryable: false,
              }),
          ),
          Effect.timeoutOrElse({
            duration: config.timeout,
            orElse: () =>
              new CliFailure({
                tag: "CliTimedOut",
                cliMessage: `CLI command timed out: ${args.join(" ")}.`,
                next: "Raise STACKS_MCP_TIMEOUT_SECONDS, or run the command in a terminal.",
                retryable: false,
              }),
          }),
        );
      });
      return CliRunner.of({ run });
    }),
  );
}
