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

const runCreate = Effect.fn("create.runCreate")(function* (options: CreateOptions) {
  const result = yield* createEntry(options);
  const output = yield* Output;
  const host = yield* Host;
  const path = output.audience === "agent" ? yield* shownPath(host.cwd, result.path) : result.path;
  const directory = `'${path.replaceAll("'", "'\\''")}'`;
  yield* output.result(
    Schema.encodeSync(CreateResult)(result),
    [
      `Created ${options.kind} ${printable(result.id)}: ${printable(path)}`,
      `Guide: ${printable(result.guide)}`,
      `Next: edit the entry, then run ${host.invocation} validate ${printable(directory)}.`,
    ].join("\n"),
  );
});

const promptedCreate = Effect.fn("create.promptedCreate")(function* (input: {
  kind?: Kind;
  from?: Origin;
  category: Category;
  yes: boolean;
}) {
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

const entryCommand = (kind: Kind) =>
  Command.make(
    kind,
    {
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
    },
    (flags) =>
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
