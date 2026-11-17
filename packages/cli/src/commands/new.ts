/** Handles `stacks new` and checks template inputs before the picker can ask questions. */
import { Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Allowlist } from "../core/allowlist";
import type { Composition } from "../core/compose/types";
import { type HandoffDecision, handoffRecord } from "../core/handoff";
import { pickNew, promptingAllowed, replayFlags, runningCommand } from "../core/prompting";
import { isStack, PAYLOADS } from "../core/registry/entry";
import { Registry, remoteRoots } from "../core/registry/registry";
import { type NewOptions, scaffold } from "../core/scaffold/new";
import { renderNew } from "../core/scaffold/report";
import { templateOverrides } from "../core/scaffold/values";
import { Usage } from "../errors";
import { BRIEF_PATH } from "../project-layout";
import { NewPreset, NewResult } from "../schemas/new";
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
  preset: Flag.Literals("preset", NewPreset.literals).pipe(
    Flag.withDescription(
      "Composition preset. Default: the preset setting, else default. Sandbox implies --yes. Lean leaves out every default fragment (git hooks, CI, the long-lived harness docs) for timed work; add them later with stacks add.",
    ),
    Flag.optional,
  ),
  payload: Flag.Literals("payload", PAYLOADS).pipe(
    Flag.withDescription(
      "The stack's payload: example (default) ships its example code; none starts with an empty public API, for stacks that offer it.",
    ),
    Flag.optional,
  ),
  ownRepo: Flag.Boolean("own-repo").pipe(
    Flag.withDescription(
      "When the directory is inside another git repository, git init the project as its own repository there, keeping fragments that need one (ci-github, git-hooks).",
    ),
    Flag.withDefault(false),
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

/** The scaffold options the parsed flags give, apart from the stack and the handoff. */
function flagOptions(flags: NewFlags) {
  return {
    dir: Option.getOrUndefined(flags.dir),
    name: Option.getOrUndefined(flags.name),
    author: Option.getOrUndefined(flags.author),
    dryRun: flags.dryRun,
    with: flags.with,
    without: flags.without,
    sandbox: flags.sandbox,
    preset: Option.getOrUndefined(flags.preset),
    payload: Option.getOrUndefined(flags.payload),
    ownRepo: flags.ownRepo,
    yes: flags.yes,
    agents: flags.agents.length ? flags.agents : undefined,
    scope: Option.getOrUndefined(flags.scope),
  };
}

/**
 * The scaffold options from the flags, with the stack and directory a person picks when no stack
 * was named. After a pick, prints the equivalent command so it can be rerun without the picker.
 */
const resolveArguments = Effect.fn("new.resolveArguments")(function* (flags: NewFlags) {
  const stack = Option.getOrUndefined(flags.stack);
  if (stack === undefined && !(yield* promptingAllowed)) return yield* new Usage();
  const options = flagOptions(flags);
  if (flags.sandbox && options.preset !== undefined && options.preset !== "sandbox")
    return yield* new Usage({ details: { flags: ["--sandbox", `--preset ${options.preset}`] } });
  if (stack !== undefined) return { ...options, stack };
  // Checks --name, --author and --scope before the picker, so a bad value fails before any question.
  yield* templateOverrides(options);
  const picked = yield* pickNew(options);
  const resolved = { ...options, ...picked };
  yield* runningCommand(newReplay(resolved, flags));
  return resolved;
});

/** The `new` command line that reproduces a picked run. */
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
      payload: options.payload,
      "own-repo": options.ownRepo,
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

type Scaffolded = Effect.Success<ReturnType<typeof scaffold>>;

/** The fragment ids telemetry reports as left out: `--without`, plus the stack's defaults under lean. */
function leftOutFragments(composition: Composition, without: ReadonlyArray<string>) {
  const dropped =
    composition.lean && isStack(composition.stack) ? composition.stack.meta.fragments.default : [];
  return [...new Set([...without, ...dropped])];
}

/**
 * Records the `new` telemetry event with the settled handoff, then flushes the spool. A preview
 * records nothing, and without consent the left-out fragments aren't looked up.
 */
const recordNew =
  (input: {
    telemetry: Telemetry["Service"];
    registry: Registry["Service"];
    scaffolded: Scaffolded;
    without: ReadonlyArray<string>;
    source: Effect.Success<ReturnType<typeof sourceValue>>;
  }) =>
  (settled: HandoffDecision) =>
    Effect.gen(function* () {
      const { telemetry, registry } = input;
      const { result, manifest, composition } = input.scaffolded;
      if (result.dryRun || (yield* telemetry.consent) !== "enabled") return;
      const without = yield* Effect.forEach(leftOutFragments(composition, input.without), (id) =>
        registry
          .get("fragment", id)
          .pipe(Effect.orElseSucceed(() => ({ id, origin: "unknown", trusted: false }))),
      );
      yield* telemetry.recordScaffold(
        {
          type: "new",
          manifest: { ...manifest, handoff: handoffRecord(settled, manifest.createdAt) },
          without,
          source: input.source,
          steps: officialSteps(composition),
        },
        registry,
      );
      yield* telemetry.flush;
    });

export const newCommand = Command.make("new", newFlags, (flags) =>
  Effect.gen(function* () {
    const { json } = yield* root;
    const output = yield* Output;
    const source = yield* sourceValue(flags.source);
    const options = yield* resolveArguments(flags);
    yield* (yield* Allowlist).refresh;
    const handoff = yield* prepareHandoff(flags, json);
    const scaffolded = yield* scaffold({ ...options, handoff });
    const { result, decision } = scaffolded;
    const telemetry = yield* Telemetry;
    const registry = yield* Registry;
    yield* completeHandoff({
      project: result.project,
      agent: result.agents[0],
      untrusted: result.untrusted,
      decision,
      preview: result.dryRun,
      beforeHandoff: recordNew({
        telemetry,
        registry,
        scaffolded,
        without: options.without,
        source,
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
