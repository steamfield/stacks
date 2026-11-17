import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { SOURCE_BUILD } from "../src/build";
import { NetLayer } from "../src/platform/net";
import { installSignalPolicy } from "../src/platform/signals";
import { AppLayer, runInvocation } from "../src/runtime";
import { Host } from "../src/services/host";
import { Output } from "../src/services/output";
import type { Writer } from "../src/services/output-write";
import { Foreground } from "../src/services/processes";
import { type AgentAdapter, agents } from "./bench/agents";
import { help, options } from "./bench/options";
import { prepare } from "./bench/prepare";
import { record } from "./bench/record";
import { run } from "./bench/run";
import { verify } from "./bench/verify";

/** Maintainer-only orchestration; the shipped command tree never imports this script. */
export const runBench = (args: readonly string[], adapters: readonly AgentAdapter[] = agents) =>
  Effect.gen(function* () {
    const parsed = yield* options(args);
    if (!parsed) {
      yield* (yield* Output).result(null, help);
      return 0;
    }
    const prepared = yield* prepare(parsed, adapters);
    const agent = yield* run(prepared);
    const checked = yield* verify(prepared);
    return yield* record(prepared, agent, checked);
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const output = yield* Output;
        yield* output.clear;
        yield* output.note(error instanceof Error ? error.message : "Bench failed");
        return 1;
      }),
    ),
    Effect.orDie,
  );

if (import.meta.main) {
  const writer =
    (stream: NodeJS.WriteStream): Writer =>
    (text) =>
      new Promise((resolve, reject) => {
        stream.write(text, (error) => (error ? reject(error) : resolve()));
      });
  const output = Output.fixed("agent", writer(process.stdout), writer(process.stderr));
  const holder = Foreground.make();
  const platform = Layer.mergeAll(
    NodeServices.layer,
    NetLayer,
    Foreground.layer(holder),
    Host.memory({ cwd: process.cwd() }),
  );
  const controller = new AbortController();
  const removeSignals = installSignalPolicy(holder, () => controller.abort());
  try {
    process.exitCode = await runInvocation(
      runBench(process.argv.slice(2)).pipe(
        Effect.tap(() => Effect.flatMap(Output, (out) => out.flush)),
        Effect.orDie,
        Effect.provide(Layer.provideMerge(AppLayer({ output, build: SOURCE_BUILD }), platform)),
        Effect.scoped,
      ),
      controller.signal,
    );
  } finally {
    removeSignals();
  }
}
