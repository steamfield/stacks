// A stand-in for bin.ts in tests/signals.test.ts: the real signal policy, the real Node platform
// layer and the live Processes service, running one scenario instead of the command tree.
// Usage: bun tests/fixtures/signals.ts <interactive|late-copy|start|slow> <dir>
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Duration, Effect, Layer } from "effect";
import { SOURCE_BUILD } from "../../src/build";
import { AppConfig } from "../../src/config";
import { installSignalPolicy } from "../../src/platform/signals";
import { runInvocation } from "../../src/runtime";
import { Foreground, Processes } from "../../src/services/processes";

const [scenario, dir] = process.argv.slice(2) as [string, string];
const mark = (name: string, value = "yes") =>
  Effect.sync(() => writeFileSync(join(dir, name), value));

const holder = Foreground.make();
let childSigintAt = 0;
const layer = Processes.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(AppConfig.layer(SOURCE_BUILD), Foreground.layer(holder))),
  Layer.provideMerge(NodeServices.layer),
);
const program = Effect.gen(function* () {
  const processes = yield* Processes;
  const env = (yield* AppConfig).childEnv([]);
  if (scenario === "interactive" || scenario === "late-copy") {
    const code = yield* processes.interactive({
      bin: process.execPath,
      args: [join(import.meta.dirname, "trap-child.ts"), dir],
      cwd: dir,
      env,
    });
    yield* mark("parent-done", String(code));
    if (scenario === "late-copy") {
      // Deliver from the child-exit continuation, without a round trip through the test's poller.
      // Wait for delivery before returning; otherwise process exit could beat the signal handler.
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            process.once("SIGINT", () => {
              writeFileSync(join(dir, "late-copy-ms"), String(Date.now() - childSigintAt));
              resolve();
            });
            process.kill(process.pid, "SIGINT");
          }),
      );
      return code;
    }
    // Keep the parent available for further signals until the test creates its release file.
    for (let waited = 0; waited < 10_000 && !existsSync(join(dir, "release")); waited += 20)
      yield* Effect.sleep(Duration.millis(20));
    return code;
  }
  yield* processes.start({ command: "echo $$ > leader; sleep 60", cwd: dir, env });
  if (scenario === "slow")
    yield* Effect.addFinalizer(() =>
      Effect.sleep(Duration.seconds(2)).pipe(Effect.andThen(mark("finalized"))),
    );
  yield* mark("ready");
  return yield* Effect.never;
}).pipe(Effect.provide(layer), Effect.scoped, Effect.orDie);

const controller = new AbortController();
const dispose = installSignalPolicy(holder, () => controller.abort());
if (scenario === "late-copy")
  process.once("SIGINT", () => {
    childSigintAt = Date.now();
    // Let the parent's policy observe the first Ctrl+C before the child can exit. Group delivery
    // can schedule the child's exit before the parent's SIGINT callback on a busy machine.
    const child = holder.foreground;
    if (child === undefined) throw new Error("first SIGINT arrived without an interactive child");
    process.kill(child, "SIGINT");
  });
try {
  process.exitCode = await runInvocation(program, controller.signal);
} finally {
  dispose();
}
