/**
 * Assembles the CLI's application services and runs one invocation to an exit status.
 *
 * `bin.ts` builds `AppLayer` once per process over the platform layer (Node's filesystem, Host
 * and the process registry) and hands `main(...)` to `runInvocation`; `tests/helpers/cli.ts` does
 * the same once per `runCli`. `runInvocation` is the only place the CLI turns an Effect into a
 * promise, which is why the exit status for an interrupted run (130) is decided here.
 */
import { Cause, Effect, Exit, Layer } from "effect";
import type { Build } from "./build";
import { AppConfig, type Environment } from "./config";
import { Logging } from "./logging";
import type { Host } from "./services/host";
import type { Output } from "./services/output";
import { Processes } from "./services/processes";
/**
 * Config, `output` (built over config and Host, so it can resolve the audience), logging and
 * Processes; the platform supplies FileSystem, Path, Host and Foreground. An `env` of
 * `undefined` reads the live process environment; tests pass their own.
 */
export const AppLayer = ({
  output,
  build,
  env,
}: {
  output: Layer.Layer<Output, never, Host | AppConfig>;
  build: Build;
  env?: Environment;
}) =>
  Layer.mergeAll(Processes.layer, Logging.layer).pipe(
    Layer.provideMerge(output),
    Layer.provideMerge(env === undefined ? AppConfig.layer(build) : AppConfig.memory(env, build)),
  );

/**
 * Runs `program` and returns its exit status. `main` settles output under a mask, but a fiber
 * interrupted by `signal` stays interrupted after that cleanup, so an interrupt-only outcome maps
 * to 130 here. Anything else that escapes `main` is rethrown for Node to report.
 */
export async function runInvocation(
  program: Effect.Effect<number>,
  signal?: AbortSignal,
): Promise<number> {
  const exit = await Effect.runPromiseExit(program, { signal });
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) return 130;
  throw Cause.squash(exit.cause);
}
