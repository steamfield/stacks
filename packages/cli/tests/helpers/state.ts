import { NodeServices } from "@effect/platform-node";
import type { Manifest } from "@steamfield/stacks-format";
import { Effect, Exit, type FileSystem, type Path, References } from "effect";
import { AppConfig, type Environment } from "../../src/config";
import type { Composition } from "../../src/core/compose/types";
import { buildManifest } from "../../src/core/project/manifest";
import { composeExit } from "./compose";

/**
 * Runs `program` on the real filesystem with an AppConfig that captured only `env`. Log records
 * are dropped, so a warning doesn't reach the test's console.
 */
export function runWith<A, E>(
  program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | AppConfig>,
  env: Environment = {},
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(
    program.pipe(
      Effect.provide(AppConfig.memory(env)),
      Effect.provide(NodeServices.layer),
      Effect.provideService(References.MinimumLogLevel, "None"),
    ),
  );
}
export async function succeed<A, E>(exit: Promise<Exit.Exit<A, E>>): Promise<A> {
  const result = await exit;
  if (Exit.isFailure(result)) throw new Error(`expected success: ${String(result.cause)}`);
  return result.value;
}
/** A real composition from the compose fixture registry (`web-stack` unless `stack` says). */
export async function composition(
  options: Parameters<typeof composeExit>[0] = {},
): Promise<Composition> {
  return succeed(composeExit(options));
}
/** The manifest `new` would write for a real composition. */
export async function manifestOf(
  options: Parameters<typeof composeExit>[0] = {},
  briefWords = 1234,
): Promise<Manifest> {
  return Effect.runPromise(buildManifest(await composition(options), { briefWords }));
}
