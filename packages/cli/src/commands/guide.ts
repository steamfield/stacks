import { Effect, Option, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import { AUTHOR_TOPICS, authorGuide, guideCommands, guideText, humanLead } from "../core/guide";
import { wrap } from "../core/wrap";
import { GuideAuthorResult, GuideResult } from "../schemas/guide";
import { Host } from "../services/host";
import { Output } from "../services/output";

/**
 * Prints the agent guide; the root with no subcommand runs the same handler. A human first gets
 * one line saying who the guide is for and how to start a project yourself.
 */
export const printGuide = Effect.gen(function* () {
  const host = yield* Host;
  const { invocation } = host;
  const output = yield* Output;
  const text = guideText(invocation);
  const human = `${humanLead(invocation)}\n\n${text}`;
  const wrapped = Option.isSome(host.columns)
    ? wrap(human, host.columns.value, host.stringWidth)
    : human;
  yield* output.result(
    Schema.encodeSync(GuideResult)({ guide: text, commands: guideCommands(invocation) }),
    output.audience === "human" ? wrapped : text,
  );
});

const authorCommand = Command.make(
  "author",
  {
    topic: Argument.String("topic").pipe(
      Argument.withDescription(
        `A reference to print: ${AUTHOR_TOPICS.join(", ")}. Omit it for the authoring guide itself, which says when to read each one.`,
      ),
      Argument.optional,
    ),
  },
  ({ topic }) =>
    Effect.gen(function* () {
      const result = yield* authorGuide(Option.getOrUndefined(topic));
      const host = yield* Host;
      const output = yield* Output;
      const text = result.text.replace(/\n$/, "");
      yield* output.result(
        Schema.encodeSync(GuideAuthorResult)(result),
        output.audience === "human" && Option.isSome(host.columns)
          ? wrap(text, host.columns.value, host.stringWidth)
          : text,
      );
    }),
).pipe(
  Command.withDescription(
    "Print the guide to writing a stack or fragment, from a repo you have or from scratch, and submitting it: the stacks-author skill, for agents without Claude Code skills. A topic prints one of its references; links between them are rewritten to these commands. Exits 0, 2 on a usage error, an unknown topic or a missing bundled guide, 6 when the guide can't be read, 130 when interrupted.",
  ),
  Command.withShortDescription("Print the guide to writing and submitting entries."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Print the authoring guide" },
    {
      command: `${commandPath.join(" ")} from-repo`,
      description: "Print how to turn an existing repo into a stack",
    },
    {
      command: `${commandPath.join(" ")} search-card --json`,
      description: "Get one topic and the list of topics as one object",
    },
  ]),
);

export const guideCommand = Command.make("guide", {}, () => printGuide).pipe(
  Command.withDescription(
    "Print the guide for coding agents: the search, show, new, verify loop and the rules. Same as running stacks with no arguments. guide author prints the guide to writing and submitting stacks and fragments. Exits 0, 2 on a usage error, 130 when interrupted.",
  ),
  Command.withShortDescription("Print the guide for coding agents."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Print the guide" },
    {
      command: `${commandPath.join(" ")} --json`,
      description: "Get the guide and its commands as one object",
    },
  ]),
  Command.withSubcommands([authorCommand]),
);
