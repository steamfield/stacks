/**
 * The bare `stacks` command and the three flags every subcommand accepts: `--json`, `--offline` and
 * `--no-telemetry`.
 *
 * It lives in its own file so subcommands can import it without importing `cli.ts`, which imports
 * them: `new` and `add` read `--json` with `yield* root` to decide whether they may launch an agent.
 * `cli.ts` adds the description, the no-subcommand handler and the subcommands.
 */
import { Command, Flag } from "effect/cli";

/**
 * The root command with its shared flags, before its handler and subcommands are attached in
 * `cli.ts`. A subcommand reads the shared flags with `yield* root` (`new` needs `--json` to
 * decide its handoff); the context is keyed by the command's name, so it is the same one.
 */
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
