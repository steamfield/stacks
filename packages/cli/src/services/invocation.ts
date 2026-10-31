import { Context, Effect, Layer } from "effect";

/** What a command reported about this invocation, for `main` to apply once it succeeded. */
export type InvocationState = {
  /** The exit status in place of 0: a launched agent's (1.4). Unset means 0. */
  status: number | undefined;
  /** Scalar fields added to the `command` log record, such as `handoff` and `agent`. */
  fields: Record<string, string>;
  /** Paths whose old bytes could not be restored or new state record could not be removed. */
  rollback: string[];
};

/** Per-invocation facts a command hands back to `main`; `main` builds a fresh one every run. */
export class Invocation extends Context.Service<
  Invocation,
  {
    /**
     * Exit with `status` if the command succeeds. Only for a status that isn't a failure of this
     * CLI, so it writes no envelope: the agent `new` launched exiting non-zero.
     */
    exitWith: (status: number) => Effect.Effect<void>;
    /** Adds fields to the `command` log record. Never argument values, paths or prompt text. */
    annotate: (fields: Record<string, string>) => Effect.Effect<void>;
    rollbackIncomplete: (path: string) => Effect.Effect<void>;
  }
>()("stacks/Invocation") {
  static make = () => {
    const state: InvocationState = { status: undefined, fields: {}, rollback: [] };
    return {
      state,
      layer: Layer.succeed(Invocation, {
        exitWith: (status) =>
          Effect.sync(() => {
            state.status = status;
          }),
        annotate: (fields) =>
          Effect.sync(() => {
            Object.assign(state.fields, fields);
          }),
        rollbackIncomplete: (path) =>
          Effect.sync(() => {
            state.rollback.push(path);
          }),
      }),
    };
  };
}
