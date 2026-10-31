// Proves @effect/vitest is installed and wired into Vitest, and that the test-kit names the
// project's Effect tests rely on still exist in the installed release. Copy these patterns.
import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Config,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

class Counter extends Context.Service<Counter, Ref.Ref<number>>()("test/Counter") {}

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}

describe("Effect test kit", () => {
  it.effect("drives time with TestClock: fork, adjust, join", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.sleep("1 hour").pipe(Effect.as("woke")));
      yield* TestClock.adjust("1 hour");
      assert.strictEqual(yield* Fiber.join(fiber), "woke");
    }),
  );

  it.effect("memoizes a layer within one build unless it is wrapped in Layer.fresh", () =>
    Effect.gen(function* () {
      const builds = yield* Ref.make(0);
      const counter = Layer.effect(
        Counter,
        Ref.update(builds, (n) => n + 1).pipe(Effect.andThen(Ref.make(0))),
      );
      yield* Effect.scoped(Layer.build(Layer.mergeAll(counter, counter)));
      assert.strictEqual(yield* Ref.get(builds), 1);
      yield* Effect.scoped(Layer.build(Layer.mergeAll(Layer.fresh(counter), Layer.fresh(counter))));
      assert.strictEqual(yield* Ref.get(builds), 3);
    }),
  );

  it.effect("asserts a typed failure as a value", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Effect.fail(new NotFound({ id: "order-1" })));
      assert.strictEqual(error._tag, "NotFound");
      assert.strictEqual(error.id, "order-1");
    }),
  );

  it.effect("keeps a defect in the Cause instead of the error channel", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.die(new Error("boom")));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasDies(exit.cause));
    }),
  );

  it.effect("reads configuration from a fresh provider, never the process environment", () =>
    Effect.gen(function* () {
      const port = yield* Config.Int("PORT");
      assert.strictEqual(port, 8080);
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT: "8080" })))),
  );
});
