import { Context, Effect, Layer } from "effect";

/** What the running command reports back to main for its `command` record; fresh per run. */
export class Invocation extends Context.Service<
  Invocation,
  { named: (command: string) => Effect.Effect<void> }
>()("app/Invocation") {
  static make = () => {
    const state: { command: string | undefined } = { command: undefined };
    return {
      state,
      layer: Layer.succeed(Invocation, {
        named: (command) =>
          Effect.sync(() => {
            state.command = command;
          }),
      }),
    };
  };
}
