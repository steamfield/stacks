import { NodeServices } from "@effect/platform-node";
import { INDEX_PUBLIC_KEYS } from "@steamfield/stacks-format";
import { Effect, Layer } from "effect";
import { expect, test } from "vitest";
import { AppConfig, SOURCE_BUILD } from "../src/config";
import { Allowlist } from "../src/core/allowlist";
import { BrokenPipe } from "../src/errors";
import { main } from "../src/main";
import { NetLayer } from "../src/platform/net";
import { AppLayer } from "../src/runtime";
import { Host } from "../src/services/host";
import { Output } from "../src/services/output";
import { Foreground } from "../src/services/processes";
import { runCli } from "./helpers/cli";

test("production AppLayer reads normalized environment lazily", async () => {
  const output = Output.memory();
  const platform = Layer.mergeAll(
    NodeServices.layer,
    Host.memory(),
    Foreground.layer(Foreground.make()),
  );
  const paths = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* AppConfig).paths;
    }).pipe(
      Effect.provide(Layer.provideMerge(AppLayer(output.layer, undefined, SOURCE_BUILD), platform)),
    ),
  );
  expect(paths.config).toContain(process.env.HOME);
});
test("one invocation finalizes scoped resources on failure", async () => {
  let finalized = 0;
  const program = Effect.acquireRelease(Effect.void, () =>
    Effect.sync(() => {
      finalized++;
    }),
  ).pipe(Effect.andThen(Effect.die("private")), Effect.scoped);
  const result = await runCli([], { program });
  expect(result.status).toBe(1);
  expect(finalized).toBe(1);
});
test("fresh invocations do not share Output buffers", async () => {
  const a = await runCli(["--version"]);
  const b = await runCli(["doctor", "--json"]);
  expect(a.stdout.trim()).toBe("0.6.0");
  expect(JSON.parse(b.stdout).version).toBe("0.6.0");
});
test("BrokenPipe is a quiet successful interruption", async () => {
  const result = await runCli([], { program: Effect.fail(new BrokenPipe()) });
  expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
});
test("actual EPIPE from Output writer is quiet", async () => {
  const output = Output.layer(
    false,
    async () => {
      throw Object.assign(new Error("closed"), { code: "EPIPE" });
    },
    async () => {
      throw new Error("must not report EPIPE");
    },
  );
  const platform = Layer.mergeAll(
    NodeServices.layer,
    Host.memory(),
    Foreground.layer(Foreground.make()),
    NetLayer,
  );
  const application = AppLayer(output, {}, SOURCE_BUILD);
  expect(
    await Effect.runPromise(
      main(["--version"]).pipe(
        Effect.provide(
          Layer.provideMerge(
            Layer.merge(
              application,
              Allowlist.layer({ keys: INDEX_PUBLIC_KEYS }).pipe(Layer.provide(application)),
            ),
            platform,
          ),
        ),
      ),
    ),
  ).toBe(0);
});
