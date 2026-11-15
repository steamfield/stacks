/**
 * The `skill install` command: copies one of the agent skills bundled with the CLI (`stacks` or
 * `stacks-author`) into a Claude Code skills directory, or prints its `SKILL.md` with `--print`.
 *
 * A skill is a folder of instructions a coding agent loads on its own. `core/skill.ts::installSkill`
 * does the comparing and writing; this file checks the skill name and renders one line about what
 * happened. `skill` itself has no handler, so `stacks skill` alone shows its help.
 */
import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { shownPath } from "../core/shown-path";
import { installSkill } from "../core/skill";
import { closest } from "../core/suggest";
import { printable } from "../core/text";
import { Usage } from "../errors";
import { SkillName, SkillResult } from "../schemas/skill";
import { Host } from "../services/host";
import { type Audience, Output } from "../services/output";

const isSkillName = Schema.is(SkillName);

/** The positional name, `stacks` when omitted; anything else is a Usage error with suggestions. */
const selectedName = (name: Option.Option<string>) =>
  Effect.gen(function* () {
    const typed = Option.getOrElse(name, () => "stacks");
    if (isSkillName(typed)) return typed;
    return yield* new Usage({
      details: {
        flag: "name",
        command: "skill install",
        value: typed,
        expected: SkillName.literals.join(" | "),
        suggestions: closest(typed, SkillName.literals),
      },
    });
  });

/** The install target as text shows it: relative to the cwd for an agent, absolute otherwise. */
const shownTarget = (result: SkillResult, audience: Audience) =>
  Effect.gen(function* () {
    if (result.path && audience === "agent")
      return yield* shownPath((yield* Host).cwd, result.path);
    return result.path ?? "";
  });

/** One line naming the installed SKILL.md, with the file count when the skill has several. */
const installedLine = (result: SkillResult, shown: string) => {
  const verb = result.action === "written" ? "Installed" : "Unchanged";
  const count = result.files.length > 1 ? ` (${result.files.length} files)` : "";
  return `${verb}: ${printable(shown)}${count}`;
};

/** `--print` shows the skill text; an install shows where it went. */
const renderSkill = (result: SkillResult, shown: string) =>
  result.action === "printed"
    ? (result.text ?? "").replace(/\n$/, "")
    : installedLine(result, shown);

const install = Command.make(
  "install",
  {
    name: Argument.String("name").pipe(
      Argument.withDescription(
        "The skill to install: stacks (the default; choosing and building from stacks) or stacks-author (writing and submitting stacks and fragments).",
      ),
      Argument.optional,
    ),
    project: Flag.Boolean("project").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Install under the git toplevel, or the working directory outside git."),
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Replace installed skill files whose content differs."),
    ),
    print: Flag.Boolean("print").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print the skill's SKILL.md only, without looking up or writing an install target. For stacks-author, links to its references become the stacks guide author command that prints each one.",
      ),
    ),
  },
  ({ name, ...flags }) =>
    Effect.gen(function* () {
      const result = yield* installSkill({ name: yield* selectedName(name), ...flags });
      const output = yield* Output;
      const shown = yield* shownTarget(result, output.audience);
      yield* output.result(Schema.encodeSync(SkillResult)(result), renderSkill(result, shown));
    }),
).pipe(
  Command.withDescription(
    "Install a bundled Claude Code skill with every file in it: stacks (the default) or stacks-author (default target: $HOME/.claude/skills/<name>/). Other agents can take SKILL.md from --print; for stacks-author they read the same text with stacks guide author. Exits 0 when written, unchanged or printed, 2 when the name is unknown, a different file is already there (TargetNotEmpty; --force replaces it) or the bundled skill is missing, 6 when HOME is unset or the target can't be written, 130 when interrupted.",
  ),
  Command.withShortDescription("Install an agent skill for Claude Code."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Install the stacks skill for your user" },
    {
      command: `${commandPath.join(" ")} stacks-author`,
      description: "Install the authoring skill, with its reference files",
    },
    {
      command: `${commandPath.join(" ")} --project`,
      description: "Install into the current repository's .claude/skills/",
    },
    {
      command: `${commandPath.join(" ")} --print`,
      description: "Print SKILL.md to copy somewhere else",
    },
  ]),
);

export const skillCommand = Command.make("skill").pipe(
  Command.withDescription(
    "Install the agent skills that ship with stacks, so your coding agent knows how to pick a stack, start a project and verify it. install is the only subcommand; its --help lists the skill names, targets and exits.",
  ),
  Command.withShortDescription("Install the bundled agent skills."),
  Command.withExamples(({ commandPath }) => [
    {
      command: `${commandPath.join(" ")} install`,
      description: "Install the stacks skill for your user",
    },
  ]),
  Command.withSubcommands([install]),
);
