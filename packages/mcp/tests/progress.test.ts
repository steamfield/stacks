import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { forwardVerifyProgress } from "../src/handlers";
import { CliRunner } from "../src/run";
import { VerifyEvent } from "../src/schemas/cli";
import { fixture, outputCli, runnerLayer, tempDir } from "./helpers/cli";

type Update = { readonly progress: number; readonly message: string };

it.effect(
  "started and finished verify events share one increasing counter and ignore other lines",
  () =>
    Effect.gen(function* () {
      const events = fixture("verify-events.jsonl");
      const decoded = yield* Effect.forEach(events.trim().split("\n"), (line) =>
        Schema.decodeUnknownEffect(VerifyEvent)(JSON.parse(line)),
      );
      expect(decoded.filter((event) => event.event === "step-started")).toHaveLength(2);
      expect(decoded.filter((event) => event.event === "step-finished")).toHaveLength(2);
      const notifications: Update[] = [];
      const onStderrLine = yield* forwardVerifyProgress((progress: Update) =>
        Effect.sync(() => {
          notifications.push(progress);
        }),
      );
      const entry = outputCli(tempDir(), {
        stderr: `not JSON\n{}\n${events}`,
        stdout: fixture("verify-green.json"),
      });
      yield* Effect.gen(function* () {
        yield* (yield* CliRunner).run(["verify", "--json"], { onStderrLine });
      }).pipe(Effect.provide(runnerLayer(entry)));
      expect(notifications.map((n) => n.progress)).toEqual([1, 2, 3, 4]);
      for (const [index, notification] of notifications.entries()) {
        const event = decoded[index];
        if (event === undefined) throw new Error("Missing captured event");
        const status = event.event === "step-started" ? "started" : event.status;
        expect(notification.message).toBe(`${event.name}: ${status}`);
        expect(notification).not.toHaveProperty("total");
      }
      const nextRequest: unknown[] = [];
      const fresh = yield* forwardVerifyProgress((progress: Update) =>
        Effect.sync(() => {
          nextRequest.push(progress);
        }),
      );
      const event = decoded[0];
      if (event === undefined) throw new Error("Missing captured event");
      yield* fresh(JSON.stringify(event));
      expect(nextRequest).toEqual([expect.objectContaining({ progress: 1 })]);
    }),
);
