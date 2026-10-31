import { Cause, Effect, Exit, Layer } from "effect";
import { AppConfig } from "./config";
import { Logging } from "./logging";
import { Output, type Writer } from "./services/output";

export const AppLayer = (
  env: Readonly<Record<string, string | undefined>>,
  json: boolean,
  stdout: Writer,
  stderr: Writer,
) =>
  Logging.layer.pipe(
    Layer.provideMerge(Output.layer(json, stdout, stderr)),
    Layer.provideMerge(AppConfig.layer(env)),
  );

export async function runInvocation(program: Effect.Effect<number>, signal?: AbortSignal) {
  const exit = await Effect.runPromiseExit(program, { signal });
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) return 130;
  throw Cause.squash(exit.cause);
}
