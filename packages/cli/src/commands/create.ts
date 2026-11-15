/**
 * The `create stack` and `create fragment` commands: start a new entry (a stack or a fragment) in
 * the user's own registry, either as a skeleton to fill in or, with `--from`, as a copy of an
 * existing entry to edit.
 *
 * `core/create.ts::createEntry` does the writing and, for an untrusted copy, shows the full report
 * and asks a person to accept it (trust model point 3). This file reads the flags and renders the
 * entry path, the authoring guide and the next step. When the id is missing, a person at a terminal
 * is asked for it through `core/prompting.ts::pickCreate`, which also prints the equivalent
 * command; anyone else gets a usage error. Plain `stacks create` asks what to create the same way,
 * or shows its help when nobody can answer.
 */
import { Category, type Kind } from "@steamfield/stacks-format";
import { Effect, Option, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { type CreateOptions, createEntry } from "../core/create";
import { pickCreate, promptingAllowed, replayFlags, runningCommand } from "../core/prompting";
import { shownPath } from "../core/shown-path";
import { printable } from "../core/text";
import { Usage } from "../errors";
import { CreateResult } from "../schemas/create";
import { Origin } from "../schemas/origin";
import { Host } from "../services/host";
import { Output } from "../services/output";

/** What a prompt can start from: whatever flags were given, with defaults for the rest. */
type PromptInput = { kind?: Kind; from?: Origin; category: Category; yes: boolean };

/** A path single-quoted for the shell, whether or not it needs it. */
const quoted = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;

const runCreate = Effect.fn("create.runCreate")(function* (options: CreateOptions) {
  const result = yield* createEntry(options);
  const output = yield* Output;
  const host = yield* Host;
  const path = output.audience === "agent" ? yield* shownPath(host.cwd, result.path) : result.path;
  yield* output.result(
    Schema.encodeSync(CreateResult)(result),
    [
      `Created ${options.kind} ${printable(result.id)}: ${printable(path)}`,
      `Guide: ${printable(result.guide)}`,
      `Next: edit the entry, then run ${host.invocation} validate ${printable(quoted(path))}.`,
    ].join("\n"),
  );
});

/** Asks a person for what's missing, prints the command they could have typed, then creates. */
const promptedCreate = Effect.fn("create.promptedCreate")(function* (input: PromptInput) {
  const picked = yield* pickCreate(input);
  yield* runningCommand([
    "create",
    picked.kind,
    picked.id,
    ...replayFlags({
      from: picked.from,
      category: picked.kind === "fragment" ? input.category : undefined,
      yes: input.yes,
    }),
  ]);
  yield* runCreate({ ...picked, category: input.category, yes: input.yes });
});

/** The flags of `create <kind>`; only a fragment takes `--category`. */
const entryFlags = (kind: Kind) => ({
  id: Argument.String("id").pipe(
    Argument.withDescription("A lowercase kebab-case entry id."),
    Argument.optional,
  ),
  from: Flag.Literals("from", Origin.literals).pipe(
    Flag.withDescription(
      "Copy this id from the bundled, index or project registry into the user registry; user is refused (exit 2), because the entry is already there.",
    ),
    Flag.optional,
  ),
  ...(kind === "fragment"
    ? {
        category: Flag.Literals("category", Category.literals).pipe(
          Flag.withDescription(
            "Category for a fresh fragment. Apps need applies_to filled before validation.",
          ),
          Flag.withDefault("tooling"),
        ),
      }
    : {}),
  yes: Flag.Boolean("yes").pipe(
    Flag.withDescription(
      "Skip the trust question after the full report; requires a person and terminal for untrusted copies.",
    ),
    Flag.withDefault(false),
  ),
});

const entryCommand = (kind: Kind) =>
  Command.make(kind, entryFlags(kind), (flags) =>
    Effect.gen(function* () {
      const options = {
        kind,
        from: Option.getOrUndefined(flags.from),
        category: flags.category ?? "tooling",
        yes: flags.yes,
      };
      const id = Option.getOrUndefined(flags.id);
      if (id !== undefined) return yield* runCreate({ ...options, id });
      if (!(yield* promptingAllowed)) return yield* new Usage();
      yield* promptedCreate(options);
    }),
  ).pipe(
    Command.withDescription(
      `Create a ${kind} in the user registry without running any tools: a skeleton, or with --from a copy of an existing entry. Prints the entry path and the authoring guide. Exits 0, 2 on a bad id, an id another registry already has, an occupied target, an unknown source or a declined confirmation, 6 when the user registry can't be written or an untrusted copy can't be confirmed by a person at a terminal, 130 when interrupted.`,
    ),
    Command.withShortDescription(`Create a ${kind} in the user registry.`),
    Command.withExamples(({ commandPath }) =>
      kind === "stack"
        ? [
            { command: `${commandPath.join(" ")} my-api`, description: "Start a stack skeleton" },
            {
              command: `${commandPath.join(" ")} go-cli --from bundled`,
              description: "Copy a bundled stack to edit",
            },
          ]
        : [
            {
              command: `${commandPath.join(" ")} my-ci --category ci`,
              description: "Start a fragment skeleton",
            },
            {
              command: `${commandPath.join(" ")} postgres --from bundled --json`,
              description: "Copy a bundled fragment and get its paths",
            },
          ],
    ),
  );

export const createCommand = Command.make("create", {}, () =>
  Effect.gen(function* () {
    if (!(yield* promptingAllowed))
      return yield* new CliError.ShowHelp({ commandPath: ["stacks", "create"], errors: [] });
    yield* promptedCreate({ category: "tooling", yes: false });
  }),
).pipe(
  Command.withDescription(
    "Start a stack or fragment in the user registry, or copy an existing entry there for editing. With no subcommand, a person at a terminal is asked what to create; otherwise this help is shown. Each subcommand's --help lists its exits.",
  ),
  Command.withExamples(({ commandPath }) => [
    {
      command: `${commandPath.join(" ")} stack my-stack`,
      description: "Write a stack skeleton to edit",
    },
    {
      command: `${commandPath.join(" ")} fragment postgres --from bundled`,
      description: "Copy a bundled fragment into the user registry",
    },
  ]),
  Command.withShortDescription("Create or copy a stack or fragment for editing."),
  Command.withSubcommands([entryCommand("stack"), entryCommand("fragment")]),
);
