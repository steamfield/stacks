import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { verifyHandler } from "../src/handlers";
import { CliRunner } from "../src/run";
import { CliErrorEnvelope } from "../src/schemas/cli";
import {
  envelopeFixture,
  fakeCli,
  jsonFixture,
  outputCli,
  runnerLayer,
  tempDir,
} from "./helpers/cli";

it.effect("a CLI killed by a signal reports CliKilled with retry guidance", () =>
  Effect.gen(function* () {
    const entry = fakeCli(tempDir(), 'process.kill(process.pid, "SIGKILL");');
    const error = yield* Effect.gen(function* () {
      const runner = yield* CliRunner;
      return yield* Effect.flip(runner.run([]));
    }).pipe(Effect.provide(runnerLayer(entry)));
    expect(error.tag).toBe("CliKilled");
    expect(error.cliMessage).toContain("SIGKILL");
    expect(error.retryable).toBe(true);
    expect(error.exitCode).toBeUndefined();
    expect(error.next).toMatch(/rerun/i);
    expect(error.next).toMatch(/memory/i);
    expect(error.next).toMatch(/stopped/i);
  }),
);

it.effect.each(["", "not JSON", "{}"])(
  "verify preserves its exit-5 envelope when stdout is %j",
  (stdout) =>
    Effect.gen(function* () {
      const root = tempDir();
      const envelope = yield* Schema.decodeUnknownEffect(CliErrorEnvelope)(
        jsonFixture("verify-failed-envelope"),
      );
      const entry = outputCli(root, {
        exit: 5,
        stdout,
        stderr: envelopeFixture("verify-failed-envelope"),
      });
      const error = yield* Effect.flip(verifyHandler({ dir: root })).pipe(
        Effect.provide(runnerLayer(entry)),
      );
      expect(error).toMatchObject({
        tag: envelope.error.tag,
        cliMessage: envelope.error.message,
        next: envelope.error.next,
        retryable: envelope.error.retryable,
        exitCode: 5,
        details: envelope.error.details,
      });
    }),
);
