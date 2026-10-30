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

const notify = <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  flushAfterOutput = true,
) =>
  Command.provideEffectDiscard(
    command,
    Effect.flatMap(Telemetry, (telemetry) =>
      telemetry.notify.pipe(
        Effect.andThen(flushAfterOutput ? telemetry.markFlushAfterOutput : Effect.void),
      ),
    ),
  );
export const cli = root.pipe(
  Command.withDescription("Start projects from stacks your coding agent builds and verifies."),
  // No subcommand: the agent guide instead of the framework's help (`--help` keeps that).
  Command.withHandler(() =>
    Effect.flatMap(Telemetry, (telemetry) =>
      telemetry.notify.pipe(
        Effect.andThen(telemetry.markFlushAfterOutput),
        Effect.andThen(printGuide),
      ),
    ),
  ),
  Command.withSubcommands([
    addCommand.pipe((command) => notify(command, false)),
    createCommand.pipe(notify),
    doctorCommand.pipe(notify),
    guideCommand.pipe(notify),
    listCommand.pipe(notify),
    newCommand.pipe((command) => notify(command, false)),
    runsCommand.pipe(notify),
    schemaCommand,
    searchCommand.pipe(notify),
    showCommand.pipe(notify),
    skillCommand.pipe(notify),
    submitCommand.pipe(notify),
    telemetryCommand,
    updateCommand.pipe(notify),
    validateCommand.pipe(notify),
    verifyCommand.pipe((command) => notify(command, false)),
  ]),
  Command.provideEffectDiscard(({ offline, noTelemetry }) =>
    Effect.flatMap(AppConfig, (config) =>
      config.setOffline(offline).pipe(Effect.andThen(config.setNoTelemetry(noTelemetry))),
    ),
  ),
);
