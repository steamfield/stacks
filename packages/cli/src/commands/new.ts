/** Handles `stacks new` and checks template inputs before the picker can ask questions. */
import { Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Allowlist } from "../core/allowlist";
import type { Composition } from "../core/compose/types";
import { type SettledHandoff, settleHandoff } from "../core/handoff/decide";
import { handoffResult, renderHandoff } from "../core/handoff/render";
import {
  annotateHandoff,
  handoffContext,
  launchHandoff,
  prepareHandoff,
  printLaunch,
  resolveChoice,
} from "../core/handoff/run";
import { templateOverrides } from "../core/project/template-values";
import { pickNew, promptingAllowed, runningCommand } from "../core/prompting";
import { isStack, PAYLOADS } from "../core/registry/entry";
import { Registry } from "../core/registry/registry";
import { remoteRoots } from "../core/registry/roots";
import { type NewOptions, scaffold } from "../core/scaffold/new";
import { renderNew } from "../core/scaffold/report";
import { Usage } from "../errors";
import { BRIEF_PATH } from "../project-layout";
import { NewPreset, NewResult } from "../schemas/new";
import { Output } from "../services/output";
import { Telemetry } from "../telemetry";
import {
  type ExactProjectOptions,
  projectFlags,
  replayProjectFlags,
  splitValues,
} from "./project-flags";
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
    Argument.map(Option.getOrUndefined),
  ),
  dir: Argument.String("dir").pipe(
    Argument.withDescription(
      "The project directory: missing, empty, or holding only .git and OS files such as .DS_Store. Defaults to the slug of --name, else ./<stack>; `.` is the current directory.",
    ),
    Argument.optional,
    Argument.map(Option.getOrUndefined),
  ),
  name: Flag.String("name").pipe(
    Flag.withDescription("Project name for templates. Default: the directory's base name."),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  ),
  author: Flag.String("author").pipe(
    Flag.withDescription(
      "Author for templates. Default: the author setting, then git user.name, else empty. An empty value suppresses the fallback.",
    ),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
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
    Flag.map(Option.getOrUndefined),
  ),
  payload: Flag.Literals("payload", PAYLOADS).pipe(
    Flag.withDescription(
      "The stack's payload: example (default) ships its example code; none starts with an empty public API, for stacks that offer it.",
    ),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
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
    Flag.map(Option.getOrUndefined),
  ),
  launch,
  noLaunch,
};

type NewFlags = Command.Command.Config.Infer<typeof newFlags>;

const newReplayNames = {
  source: null,
  stack: null,
  dir: null,
  name: "name",
  author: "author",
  dryRun: "dry-run",
  preset: "preset",
  payload: "payload",
  ownRepo: "own-repo",
  with: "with",
  without: "without",
  sandbox: "sandbox",
  yes: "yes",
  agents: "agents",
  scope: "scope",
  launch: "launch",
  noLaunch: "no-launch",
} satisfies Record<keyof NewFlags, string | null>;

/**
 * The scaffold options from the flags, with the stack and directory a person picks when no stack
 * was named. After a pick, prints the equivalent command so it can be rerun without the picker.
 */
const resolveArguments = Effect.fn("new.resolveArguments")(function* (flags: NewFlags) {
  const { source: _source, stack, launch: _launch, noLaunch: _noLaunch, ...parsed } = flags;
  if (stack === undefined && !(yield* promptingAllowed)) return yield* new Usage();
  const options = parsed satisfies ExactProjectOptions<
    typeof parsed,
    Omit<NewOptions, "stack" | "handoff">
  >;
  if (options.sandbox && options.preset !== undefined && options.preset !== "sandbox")
    return yield* new Usage({ details: { flags: ["--sandbox", `--preset ${options.preset}`] } });
  if (stack !== undefined) return { ...options, stack };
  // Checks --name, --author and --scope before the picker, so a bad value fails before any question.
  yield* templateOverrides(options);
  const picked = yield* pickNew(options);
  const resolved = { ...options, ...picked };
  yield* runningCommand([
    "new",
    picked.stack,
    ...replayProjectFlags(newReplayNames, { ...flags, ...picked }),
    "--",
    picked.dir,
  ]);
  return resolved;
});

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
const recordNew = Effect.fn("new.recordTelemetry")(function* (input: {
  telemetry: Telemetry["Service"];
  registry: Registry["Service"];
  scaffolded: Scaffolded;
  decision: SettledHandoff;
  without: ReadonlyArray<string>;
  source: Effect.Success<ReturnType<typeof sourceValue>>;
}) {
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
      manifest: settleHandoff(manifest, input.decision, manifest.createdAt),
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
    const preferences = yield* prepareHandoff(flags, json);
    const scaffolded = yield* scaffold({ ...options, handoff: preferences });
    const { result } = scaffolded;
    const telemetry = yield* Telemetry;
    const registry = yield* Registry;
    const context = yield* handoffContext(result.project, result.agents[0], result.untrusted);
    const summary = renderNew({ ...result, untrusted: context.untrusted }, context);
    const { decision, prefix } = yield* resolveChoice(scaffolded.decision, result.project, summary);
    yield* recordNew({
      telemetry,
      registry,
      scaffolded,
      decision,
      without: options.without,
      source,
    });
    yield* annotateHandoff(decision);
    if (decision.kind !== "launch") {
      const handoff = handoffResult(decision, context.invocation);
      return yield* output.result(
        Schema.encodeSync(NewResult)({ ...result, handoff }),
        result.dryRun ? summary : `${prefix}${renderHandoff(decision, context)}`,
      );
    }
    yield* printLaunch(decision, context.shown, prefix);
    yield* launchHandoff(decision, result.project, context);
  }).pipe(
    recordCommandError("new", flags.stack),
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
