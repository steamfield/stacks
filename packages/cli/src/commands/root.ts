/**
 * Owns the root command and shared flags. Keeping it separate lets handlers access parsed flags
 * without importing the command tree that imports them.
 */
import { Command, Flag } from "effect/cli";

/** `yield* root` shares the parsed context with `cli` because both use the same command name. */
export const root = Command.make("stacks").pipe(
  Command.withSharedFlags({
    noTelemetry: Flag.Boolean("no-telemetry").pipe(
      Flag.withDescription("Skip telemetry for this invocation, keeping queued events."),
      Flag.withDefault(false),
    ),
    offline: Flag.Boolean("offline").pipe(
      Flag.withDescription(
        "Make no network requests: use cached and bundled entries only. update and submit refuse it.",
      ),
      Flag.withDefault(false),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription(
        "Write one JSON result to stdout; a failure writes one JSON error envelope as the last stderr line.",
      ),
      Flag.withDefault(false),
    ),
  }),
);
