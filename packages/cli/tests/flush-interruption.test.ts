import { Effect } from "effect";
import { expect, test } from "vitest";
import { Output } from "../src/services/output";
import { quiet, runCli } from "./helpers/cli";

test("an interrupted flushNow finishes its stdout write before the error envelope", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const order: string[] = [];
  let writes = 0;
  const controller = new AbortController();
  const program = Effect.gen(function* () {
    const output = yield* Output;
    yield* output.result({ ok: true }, "handing off");
    yield* output.flushNow;
  });
  const running = runCli([], {
    program,
    env: quiet,
    signal: controller.signal,
    stdout: async () => {
      writes++;
      entered.resolve();
      await release.promise;
      order.push("stdout");
    },
    stderr: async () => {
      order.push("stderr");
    },
  }).then((result) => {
    order.push("finished");
    return result;
  });

  await entered.promise;
  controller.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  release.resolve();

  const result = await running;
  expect(result).toEqual({
    status: 130,
    stdout: "handing off\n",
    stderr: "Command interrupted.\n  Next: run the same command again when you're ready.\n",
  });
  expect(writes).toBe(1);
  expect(order).toEqual(["stdout", "stderr", "finished"]);
});
