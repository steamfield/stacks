import { AgentId, Harness } from "@steamfield/stacks-format";
import { Cause, Clock, Console, Effect, Exit, Logger, Random, References } from "effect";
import { CliConfig, CliError, CliOutput, Command, GlobalFlag, type HelpDoc } from "effect/cli";
import { cli } from "./cli";
import { AppConfig, type LogSettings } from "./config";
import { helpFooter } from "./core/guide";
import { Stats } from "./core/stats";
import { closest } from "./core/suggest";
import {
  type AppError,
  BrokenPipe,
  Defect,
  exitCode,
  Interrupted,
  keepsResult,
  knownError,
  Usage,
} from "./errors";
import { defectTrace, entry, Logging } from "./logging";
import { Host } from "./services/host";
import { Invocation } from "./services/invocation";
import { Output } from "./services/output";
import { Telemetry } from "./telemetry";
import { VERSION } from "./version";
/** Whether one of `flags` comes before any `--`; what follows `--` belongs to the command. */
export function hasFlag(args: readonly string[], ...flags: readonly string[]): boolean {
  const end = args.indexOf("--");
  return (end === -1 ? args : args.slice(0, end)).some((arg) => flags.includes(arg));
}
/** The listed subcommand names (and aliases) under `path`, which starts with the root's name. */
function subcommandNames(root: Command.Command.Any, path: readonly string[]): string[] {
  let node: Command.Command.Any | undefined = root;
  for (const name of path.slice(1))
    node = node?.subcommands.flatMap((group) => group.commands).find((c) => c.name === name);
  return (node?.subcommands ?? [])
    .flatMap((group) => group.commands)
    .filter((command) => !command.unlisted)
    .flatMap((command) => (command.alias ? [command.name, command.alias] : [command.name]));
}
/** Help was asked for the root itself: `--help` with no subcommand name before any `--`. */
function rootHelp(args: readonly string[]): boolean {
  const end = args.indexOf("--");
  const names = subcommandNames(cli, [cli.name]);
  return (
    hasFlag(args, "--help", "-h") &&
    !(end === -1 ? args : args.slice(0, end)).some((arg) => names.includes(arg))
  );
}
/**
 * A parser failure is Usage; an unknown subcommand names close known subcommands (the
 * framework's own suggestions are discarded for `closest`) and a rejected value names its flag.
 */
function usage(
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

/** The formatter receives the parser's command-specific help, including inherited flags. */
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

/** A flag before a subcommand belongs to its ancestor, not the selected command's help. */
const captureUnknownFlagHelp = Effect.fn("main.captureUnknownFlagHelp")(function* (error: unknown) {
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

export function main(
  args: readonly string[],
  program: Effect.Effect<
    void,
    unknown,
    Command.Services<typeof cli> | Command.Environment
  > = Command.runWith(cli, { version: VERSION, renderErrors: false })(args),
  telemetryOptions: { officialUrl?: string } = {},
) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const output = yield* Output;
      const { invocation } = yield* Host;
      const logging = yield* Logging;
      const config = yield* AppConfig;
      const settings = yield* config.logging;
      const started = yield* Clock.currentTimeMillis;
      const invocationId = `${started}-${(yield* Random.next).toString(36).slice(2, 10)}`;
      const framework: string[] = [];
      const captured = captureConsole(framework);
      const formatter = yield* CliOutput.Formatter;
      let help: HelpDoc.HelpDoc | undefined;
      const captureHelp: CliOutput.Formatter = {
        ...formatter,
        formatHelpDoc: (doc) => {
          help = doc;
          return formatter.formatHelpDoc(doc);
        },
      };
      const reported = Invocation.make();
      const exit = yield* Effect.exit(
        restore(
          program.pipe(
            Effect.catch(captureUnknownFlagHelp),
            Effect.provide(reported.layer),
            Effect.provideService(Console.Console, captured),
            Effect.provideService(CliOutput.Formatter, captureHelp),
            Effect.provide(Logger.layer([logging.logger])),
            Effect.provideService(References.MinimumLogLevel, settings.level),
            Effect.annotateLogs({ invocationId }),
          ),
        ),
      );
      const observed = observeExit(exit, help);
      if (observed.error instanceof BrokenPipe) return 0;
      if (hasFrameworkOutput(observed, framework))
        yield* writeFramework({ framework, args, invocation });
      // Log lines reach stderr only for a human; an agent or JSON reader gets them in the file only.
      // The command's own records go first, so a failure's `Next:` line ends human stderr.
      const quiet = output.audience !== "human";
      yield* logging.flush(settings, quiet);
      const written = yield* settleOutput(observed.error, invocation, reported.state.rollback);
      if (written.closed) return 0;
      yield* (yield* Telemetry).flushAfterOutput;
      const { error, unwritten } = written;
      const defect = written.defect ?? observed.defect;
      // A command's own status (a launched agent's) applies only when the command succeeded.
      const status = error ? exitCode(error) : (reported.state.status ?? 0);
      const finished = yield* Clock.currentTimeMillis;
      recordCommand({
        settings,
        logging,
        finished,
        started,
        invocationId,
        error,
        defect,
        unwritten,
        status,
        fields: reported.state.fields,
      });
      yield* logging.flush(settings, quiet || expectedFailure(error, defect));
      return status;
    }),
  ).pipe(Effect.provide(Telemetry.layer(telemetryOptions)), Effect.provide(Stats.layer));
}

function captureConsole(framework: string[]): Console.Console {
  const capture = (...values: ReadonlyArray<unknown>) => {
    framework.push(values.map(String).join(" "));
  };
  const captured: Console.Console = {
    assert: (_condition, ...values) => capture(...values),
    clear: () => {},
    count: capture,
    countReset: () => {},
    debug: capture,
    dir: capture,
    dirxml: capture,
    error: capture,
    group: capture,
    groupCollapsed: capture,
    groupEnd: () => {},
    info: capture,
    log: capture,
    table: capture,
    time: () => {},
    timeEnd: () => {},
    timeLog: capture,
    trace: capture,
    warn: capture,
  };
  return captured;
}

type ObservedExit = { error?: AppError; defect?: string; help: boolean };

function failureError(cause: Cause.Cause<unknown>, help?: HelpDoc.HelpDoc): AppError {
  if (Cause.hasInterruptsOnly(cause)) return new Interrupted();
  const failure = cause.reasons.find(Cause.isFailReason);
  if (!failure) return new Defect();
  const known = knownError(failure.error);
  if (known) return known;
  if (CliError.isCliError(failure.error)) return usage(failure.error, help);
  return new Defect();
}

function observeExit(exit: Exit.Exit<void, unknown>, help?: HelpDoc.HelpDoc): ObservedExit {
  if (Exit.isSuccess(exit)) return { help: false };
  const failure = exit.cause.reasons.find(Cause.isFailReason);
  if (
    failure &&
    CliError.isCliError(failure.error) &&
    failure.error._tag === "ShowHelp" &&
    failure.error.errors.length === 0
  )
    return { help: true };
  const error = failureError(exit.cause, help);
  if (error instanceof Defect && !knownError(failure?.error))
    return { error, help: false, defect: defectTrace(Cause.squash(exit.cause)) };
  return { error, help: false };
}

type FrameworkOutput = { framework: string[]; args: readonly string[]; invocation: string };
const writeFramework = ({ framework, args, invocation }: FrameworkOutput) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const plain = framework
      .join("\n")
      .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
    // The root's help ends with where an agent starts; a subcommand's help doesn't.
    const text = rootHelp(args) ? `${plain}\n\n${helpFooter(invocation)}` : plain;
    yield* output.result(
      hasFlag(args, "--version", "-v") ? { version: VERSION } : { help: text },
      hasFlag(args, "--version", "-v") ? VERSION : text,
    );
  });

type WriteOutcome = { error?: AppError; defect?: string; unwritten?: string; closed?: boolean };

const flushKeptResult = Effect.gen(function* () {
  const output = yield* Output;
  const flushed = yield* Effect.exit(output.flush);
  if (Exit.isSuccess(flushed)) return undefined;
  const failure = flushed.cause.reasons.find(Cause.isFailReason);
  if (failure && !(failure.error instanceof BrokenPipe))
    return knownError(failure.error)?._tag ?? "Defect";
  return undefined;
});

const writeFailure = (
  error: AppError,
  invocation: string,
  rollback: ReadonlyArray<string>,
): Effect.Effect<WriteOutcome, never, Output> =>
  Effect.gen(function* () {
    const output = yield* Output;
    // A keeps-result failure writes its report first; the envelope still comes last on stderr.
    // A closed stdout or stderr can't turn it into a pass.
    const keep = keepsResult(error);
    const unwritten = keep ? yield* flushKeptResult : undefined;
    if (!keep) yield* output.clear;
    const written = yield* Effect.exit(output.error(error, invocation, rollback));
    if (Exit.isSuccess(written)) return { error, unwritten };
    if (
      !keep &&
      written.cause.reasons.some(
        (reason) => Cause.isFailReason(reason) && reason.error instanceof BrokenPipe,
      )
    )
      return { closed: true };
    if (!written.cause.reasons.some(Cause.isDieReason)) return { error, unwritten };
    // The details didn't encode against their closed schema: report a defect instead.
    error = new Defect();
    const defect = defectTrace(Cause.squash(written.cause));
    yield* output.error(error, invocation, rollback).pipe(Effect.ignoreCause);
    return { error, defect, unwritten };
  });

const flushSuccess = (invocation: string): Effect.Effect<WriteOutcome, never, Output> =>
  Effect.gen(function* () {
    const output = yield* Output;
    const flushed = yield* Effect.exit(output.flush);
    if (Exit.isSuccess(flushed)) return {};
    const failure = flushed.cause.reasons.find(Cause.isFailReason);
    if (failure?.error instanceof BrokenPipe) return { closed: true };
    const error = failure ? (knownError(failure.error) ?? new Defect()) : new Defect();
    const defect = error instanceof Defect ? defectTrace(Cause.squash(flushed.cause)) : undefined;
    yield* output.error(error, invocation).pipe(Effect.ignoreCause);
    return { error, defect };
  });

const settleOutput = (
  error: AppError | undefined,
  invocation: string,
  rollback: ReadonlyArray<string>,
) => (error ? writeFailure(error, invocation, rollback) : flushSuccess(invocation));

/**
 * Whether the summary record is an expected failure's, which goes to the log file only: stderr
 * already reports it. A defect's stays on human stderr, where its stack frames say why.
 */
const expectedFailure = (error: AppError | undefined, defect: string | undefined) =>
  error !== undefined && defect === undefined;

type CommandLog = {
  settings: LogSettings;
  logging: { records: ReturnType<typeof entry>[] };
  finished: number;
  started: number;
  invocationId: string;
  error: AppError | undefined;
  defect: string | undefined;
  unwritten: string | undefined;
  status: number;
  fields: Readonly<Record<string, string | number | boolean | null>>;
};
function recordCommand({
  settings,
  logging,
  finished,
  started,
  invocationId,
  error,
  defect,
  unwritten,
  status,
  fields,
}: CommandLog) {
  const rank = { Trace: 0, Debug: 1, Info: 2, Warn: 3, Error: 4, Fatal: 5, None: 6 };
  if (rank[settings.level] <= (error ? 4 : 2))
    logging.records.push(
      entry({
        date: new Date(finished),
        level: error ? "Error" : "Info",
        message: "command",
        annotations: {
          invocationId,
          duration: finished - started,
          outcome: error ? "failure" : "success",
          status,
          ...fields,
          ...(defect ? { defect } : {}),
          ...(unwritten ? { result: "unwritten", resultError: unwritten } : {}),
        },
        error,
      }),
    );
}

function hasFrameworkOutput(observed: ObservedExit, framework: string[]): boolean {
  return !observed.error && (observed.help || framework.length > 0);
}
