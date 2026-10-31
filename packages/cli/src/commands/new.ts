import { Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Allowlist } from "../core/allowlist";
import { handoffRecord } from "../core/handoff";
import { pickNew, promptingAllowed, replayFlags, runningCommand } from "../core/prompting";
import { Registry, remoteRoots } from "../core/registry/registry";
import { type NewOptions, scaffold } from "../core/scaffold/new";
import { renderNew } from "../core/scaffold/report";
import { templateOverrides } from "../core/scaffold/values";
import { Usage } from "../errors";
import { BRIEF_PATH } from "../project-layout";
import { NewResult } from "../schemas/new";
import { Output } from "../services/output";
import { Telemetry } from "../telemetry";
import { completeHandoff, prepareHandoff, projectFlags, splitValues } from "./handoff";
import { root } from "./root";
import { officialSteps, recordCommandError, sourceFlag, sourceValue } from "./telemetry-hooks";

const ids = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.atLeast(0), Flag.map(splitValues));

const { launch, noLaunch, ...sharedFlags } = projectFlags("new");

const newFlags = {
  source: sourceFlag,
  stack: Argument.String("stack").pipe(
    Argument.withDescription("The stack to start from (see `list stacks`)."),
    Argument.optional,
  ),
  dir: Argument.String("dir").pipe(
    Argument.withDescription(
      "The project directory: missing, empty, or holding only .git and OS files such as .DS_Store. Defaults to the slug of --name, else ./<stack>; `.` is the current directory.",
    ),
    Argument.optional,
  ),
  name: Flag.String("name").pipe(
    Flag.withDescription("Project name for templates. Default: the directory's base name."),
    Flag.optional,
  ),
  author: Flag.String("author").pipe(
    Flag.withDescription(
      "Author for templates. Default: the author setting, then git user.name, else empty. An empty value suppresses the fallback.",
    ),
    Flag.optional,
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription(
      "Compose and render the plan without writing anything or starting an agent.",
    ),
    Flag.withDefault(false),
  ),
  preset: Flag.Literals("preset", ["default", "sandbox"]).pipe(
    Flag.withDescription(
      "Composition preset. Default: the preset setting, else default. Sandbox implies --yes.",
    ),
    Flag.optional,
  ),
  with: ids("with", "Add optional fragments or an app. Repeatable or comma-separated."),
  without: ids("without", "Leave out default fragments. Repeatable or comma-separated."),
  ...sharedFlags,
  scope: Flag.String("scope").pipe(
    Flag.withDescription(
      "npm scope for the package_scope template variable, with or without @. Default: the package_scope setting, else none.",
    ),
    Flag.optional,
  ),
  launch,
  noLaunch,
};

type NewFlags = Command.Command.Config.Infer<typeof newFlags>;

const resolveArguments = Effect.fn("new.resolveArguments")(function* (flags: NewFlags) {
  const stack = Option.getOrUndefined(flags.stack);
  if (stack === undefined && !(yield* promptingAllowed)) return yield* new Usage();
  const options = {
    dir: Option.getOrUndefined(flags.dir),
    name: Option.getOrUndefined(flags.name),
    author: Option.getOrUndefined(flags.author),
    dryRun: flags.dryRun,
    with: flags.with,
    without: flags.without,
    sandbox: flags.sandbox,
    preset: Option.getOrUndefined(flags.preset),
    yes: flags.yes,
    agents: flags.agents.length ? flags.agents : undefined,
    scope: Option.getOrUndefined(flags.scope),
  };
  if (flags.sandbox && options.preset === "default")
    return yield* new Usage({ details: { flags: ["--sandbox", "--preset default"] } });
  if (stack !== undefined) return { ...options, stack };
  yield* templateOverrides(options);
  const picked = yield* pickNew(options);
  const resolved = { ...options, ...picked };
  yield* runningCommand(newReplay(resolved, flags));
  return resolved;
});

function newReplay(
  options: Omit<NewOptions, "handoff">,
  flags: Pick<NewFlags, "launch" | "noLaunch">,
) {
  return [
    "new",
    options.stack,
    ...replayFlags({
      name: options.name,
      author: options.author,
      "dry-run": options.dryRun,
      preset: options.preset,
      with: options.with,
      without: options.without,
      sandbox: options.sandbox,
      yes: options.yes,
      agents: options.agents,
      scope: options.scope,
      launch: Option.getOrUndefined(flags.launch),
      "no-launch": flags.noLaunch,
    }),
    "--",
    ...(options.dir === undefined ? [] : [options.dir]),
  ];
}

export const newCommand = Command.make("new", newFlags, (flags) =>
  Effect.gen(function* () {
    const { json } = yield* root;
    const output = yield* Output;
    const source = yield* sourceValue(flags.source);
    const options = yield* resolveArguments(flags);
    yield* (yield* Allowlist).refresh;
    const handoff = yield* prepareHandoff(flags, json);
    const { result, decision, manifest, composition } = yield* scaffold({ ...options, handoff });
    const telemetry = yield* Telemetry;
    const registry = yield* Registry;
    yield* completeHandoff({
      project: result.project,
      agent: result.agents[0],
      untrusted: result.untrusted,
      decision,
      preview: result.dryRun,
      beforeHandoff: (settled) =>
        Effect.gen(function* () {
          if (result.dryRun || (yield* telemetry.consent) !== "enabled") return;
          const without = yield* Effect.forEach(options.without, (id) =>
            registry
              .get("fragment", id)
              .pipe(Effect.orElseSucceed(() => ({ id, origin: "unknown", trusted: false }))),
          );
          yield* telemetry.recordScaffold(
            {
              type: "new",
              manifest: { ...manifest, handoff: handoffRecord(settled, manifest.createdAt) },
              without,
              source,
              steps: officialSteps(composition),
            },
            registry,
          );
          yield* telemetry.flush;
        }),
      render: (context) =>
        renderNew({ ...result, untrusted: context.untrusted }, { ...context, style: output.style }),
      encode: (handoff) => Schema.encodeSync(NewResult)({ ...result, handoff }),
    });
  }).pipe(
    recordCommandError("new", Option.getOrUndefined(flags.stack)),
    Effect.provide(Layer.unwrap(Effect.map(remoteRoots, Registry.layer))),
  ),
).pipe(
  Command.withDescription(
    `Start a project from a stack: write its starter files and ${BRIEF_PATH}, the task for your coding agent. Runs nothing from the stack; verify is the definition of done. Exits 0 on success, 2 on bad input, an unknown entry, a non-empty target (TargetNotEmpty) or conflicting fragments (ComposeConflict), 3 on bad configuration, 6 when a write is refused, 130 when interrupted; after launching a terminal agent, the agent's own status; an app launch exits 0.`,
  ),
  Command.withShortDescription("Start a project from a stack and write its brief."),
  Command.withExamples(({ commandPath }) => [
    {
      command: `${commandPath.join(" ")} typescript-cli my-cli`,
      description: "Write the project, then hand it to your coding agent",
    },
    {
      command: `${commandPath.join(" ")} astro-blog my-blog --sandbox --dry-run`,
      description: "Preview a local-only project without writing anything",
    },
    {
      command: `${commandPath.join(" ")} typescript-cli my-cli --sandbox --json`,
      description: "Write the project and get a NewResult object, as an agent would",
    },
  ]),
);
