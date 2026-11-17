import { AgentId, Harness } from "@steamfield/stacks-format";
import { Effect } from "effect";
import {
  CliConfig,
  CliError,
  type CliOutput,
  type Command,
  GlobalFlag,
  type HelpDoc,
} from "effect/cli";
import { cli } from "./cli";
import { closest } from "./core/text/suggest";
import { Usage } from "./errors";
import { VERSION } from "./version";

function childCommands(command: Command.Command.Any): Command.Command.Any[] {
  return command.subcommands.flatMap((group) => group.commands);
}
/** The listed subcommand names (and aliases) under `path`, which starts with the root's name. */
export function subcommandNames(root: Command.Command.Any, path: readonly string[]): string[] {
  let node: Command.Command.Any | undefined = root;
  for (const name of path.slice(1))
    node = node && childCommands(node).find((command) => command.name === name);
  return (node ? childCommands(node) : [])
    .filter((command) => !command.unlisted)
    .flatMap((command) => (command.alias ? [command.name, command.alias] : [command.name]));
}

/**
 * Maps a parser failure to `Usage`. `ShowHelp` wraps the real parser error, which is unwrapped
 * with its command path. An unknown subcommand names close known subcommands (the framework's own
 * suggestions are discarded for `closest`) and a rejected value names its flag.
 */
export function usage(
  error: CliError.CliError,
  help?: HelpDoc.HelpDoc,
  command: string = cli.name,
): Usage {
  if (error._tag === "ShowHelp") {
    const nested = error.errors.find(
      (e) =>
        e._tag === "UnknownSubcommand" ||
        e._tag === "UnrecognizedOption" ||
        e._tag === "InvalidValue" ||
        e._tag === "MissingArgument",
    );
    return nested
      ? usage(nested, help, error.commandPath.slice(1).join(" ") || cli.name)
      : new Usage();
  }
  if (error._tag === "UnrecognizedOption") return unknownFlagUsage(error, help);
  if (error._tag === "InvalidValue") return invalidValueUsage(error, command);
  if (error._tag === "MissingArgument")
    return new Usage({
      details: { flag: error.argument, value: "", expected: "a required argument", command },
    });
  if (error._tag === "UnknownSubcommand")
    return new Usage({
      details: {
        command: error.subcommand,
        suggestions: closest(error.subcommand, subcommandNames(cli, error.parent ?? [])),
      },
    });
  return new Usage();
}

/**
 * An unknown flag suggests close flags of the command, then close positional arguments, three at
 * most. `help` is the parser's command-specific help, including inherited flags.
 */
function unknownFlagUsage(error: CliError.UnrecognizedOption, help?: HelpDoc.HelpDoc): Usage {
  const flags = [...(help?.flags ?? []), ...(help?.globalFlags ?? [])].flatMap((flag) => [
    `--${flag.name}`,
    ...flag.aliases,
  ]);
  const suggestions = closest(error.option, [...new Set(flags)]);
  const arguments_ = closest(
    error.option.replace(/^-+/, ""),
    (help?.args ?? []).map((argument) => argument.name),
  ).map((name) => `<${name}> (positional argument)`);
  return new Usage({
    details: {
      flag: error.option,
      command: error.command?.slice(1).join(" ") || cli.name,
      suggestions: [...suggestions, ...arguments_].slice(0, 3),
    },
  });
}

/**
 * Renders help for the command that owns an unknown flag when it differs from the selected
 * command (a flag before a subcommand belongs to its ancestor), so `unknownFlagUsage` suggests
 * from the right flags. The error is always passed on.
 */
export const captureUnknownFlagHelp = Effect.fn("main.captureUnknownFlagHelp")(function* (
  error: unknown,
) {
  if (CliError.isCliError(error) && error._tag === "ShowHelp") {
    const unknown = error.errors.find((nested) => nested._tag === "UnrecognizedOption");
    const commandPath = unknown?.command;
    if (commandPath && commandPath.join(" ") !== error.commandPath.join(" ")) {
      const { builtIns } = yield* CliConfig.CliConfig;
      // Invoke the public help action with the parsed path; no arguments are parsed again.
      yield* GlobalFlag.Help.run(true, { builtIns, command: cli, commandPath, version: VERSION });
    }
  }
  return yield* Effect.fail(error);
});

/** Close valid values for a rejected one: agent ids, launch harnesses or a choice's literals. */
function valueSuggestions(error: CliError.InvalidValue): string[] | undefined {
  if (!error.value) return undefined;
  if (error.option === "agents") return closest(error.value, AgentId.literals);
  if (error.option === "launch") return closest(error.value, Harness.literals);
  // Choice primitives report literal values separated by pipes, quoted on invalid input.
  if (!error.expected.includes(" | ")) return undefined;
  const choices = error.expected.split(" | ").map((value) => value.replace(/^"|"$/g, ""));
  return closest(error.value, choices);
}

function invalidValueUsage(error: CliError.InvalidValue, command: string): Usage {
  const suggestions = valueSuggestions(error);
  return new Usage({
    details: {
      flag: error.kind === "argument" ? error.option : `--${error.option}`,
      value: error.value,
      expected: error.expected,
      command,
      ...(suggestions === undefined ? {} : { suggestions }),
    },
  });
}

/**
 * Wraps the framework's help formatter to remember the last help document it rendered, which
 * `unknownFlagUsage` reads for the command's flags.
 */
export function helpRecorder(formatter: CliOutput.Formatter) {
  let last: HelpDoc.HelpDoc | undefined;
  const recording: CliOutput.Formatter = {
    ...formatter,
    formatHelpDoc: (doc) => {
      last = doc;
      return formatter.formatHelpDoc(doc);
    },
  };
  return { formatter: recording, last: () => last };
}
