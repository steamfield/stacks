/**
 * Assembles the command tree in the order shown by `stacks --help`. The root applies invocation-
 * wide flags before any handler reads config.
 */
import { Effect } from "effect";
import { Command } from "effect/cli";
import { addCommand } from "./commands/add";
import { createCommand } from "./commands/create";
import { doctorCommand } from "./commands/doctor";
import { guideCommand, printGuide } from "./commands/guide";
import { listCommand } from "./commands/list";
import { newCommand } from "./commands/new";
import { root } from "./commands/root";
import { runsCommand } from "./commands/runs";
import { schemaCommand } from "./commands/schema";
import { searchCommand } from "./commands/search";
import { showCommand } from "./commands/show";
import { skillCommand } from "./commands/skill";
import { submitCommand } from "./commands/submit";
import { telemetryCommand } from "./commands/telemetry";
import { updateCommand } from "./commands/update";
import { validateCommand } from "./commands/validate";
import { verifyCommand } from "./commands/verify";
import { AppConfig } from "./config";
import { Telemetry } from "./telemetry";

/**
 * Shows the telemetry notice if it is due; with `flushAfterOutput`, `main` also sends queued events
 * after the command's output is written.
 */
const telemetryNotice = (flushAfterOutput: boolean) =>
  Effect.flatMap(Telemetry, (telemetry) =>
    telemetry.notify.pipe(
      Effect.andThen(flushAfterOutput ? telemetry.markFlushAfterOutput : Effect.void),
    ),
  );

/** Runs the telemetry notice before `command`'s handler. */
const notify = <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  flushAfterOutput = true,
) => Command.provideEffectDiscard(command, telemetryNotice(flushAfterOutput));

/** Applies the shared `--offline` and `--no-telemetry` flags to this invocation's config. */
const applySharedFlags = ({
  offline,
  noTelemetry,
}: {
  readonly offline: boolean;
  readonly noTelemetry: boolean;
  readonly json: boolean;
}) =>
  Effect.flatMap(AppConfig, (config) =>
    config.setOffline(offline).pipe(Effect.andThen(config.setNoTelemetry(noTelemetry))),
  );

export const cli = root.pipe(
  Command.withDescription("Start projects from stacks your coding agent builds and verifies."),
  // No subcommand: the agent guide instead of the framework's help (`--help` keeps that).
  Command.withHandler(() => telemetryNotice(true).pipe(Effect.andThen(printGuide))),
  Command.withSubcommands([
    // `add`, `new` and `verify` send their own telemetry, so they don't ask `main` to.
    notify(addCommand, false),
    notify(createCommand),
    notify(doctorCommand),
    notify(guideCommand),
    notify(listCommand),
    notify(newCommand, false),
    notify(runsCommand),
    schemaCommand,
    notify(searchCommand),
    notify(showCommand),
    notify(skillCommand),
    notify(submitCommand),
    // Reading or changing the telemetry setting bypasses the notice.
    telemetryCommand,
    notify(updateCommand),
    notify(validateCommand),
    notify(verifyCommand, false),
  ]),
  Command.provideEffectDiscard(applySharedFlags),
);
