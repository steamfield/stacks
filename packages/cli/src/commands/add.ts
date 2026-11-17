/** Handles `stacks add` and records telemetry after the handoff settles. */
import { Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { add } from "../core/add/index";
import { renderAdd } from "../core/add/report";
import type { AddOptions } from "../core/add/types";
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
import { pickAdd, promptingAllowed, runningCommand } from "../core/prompting";
import { Registry } from "../core/registry/registry";
import { projectRoots } from "../core/registry/roots";
import { Usage } from "../errors";
import { INCOMING } from "../project-layout";
import { AddResult } from "../schemas/add";
import { Host } from "../services/host";
import { Output } from "../services/output";
import { Telemetry } from "../telemetry";
import { type ExactProjectOptions, projectFlags, replayProjectFlags } from "./project-flags";
import { root } from "./root";
import { officialSteps, recordCommandError, sourceFlag, sourceValue } from "./telemetry-hooks";

const addFlags = {
  source: sourceFlag,
  fragments: Argument.String("fragment").pipe(
    Argument.withDescription("One or more fragments to apply (see `list fragments`)."),
    Argument.atLeast(0),
  ),
  dir: Flag.String("dir").pipe(
    Flag.withDescription("Existing project directory. Defaults to the current directory."),
    Flag.optional,
  ),
  ...projectFlags("add"),
};

type AddFlags = Command.Command.Config.Infer<typeof addFlags>;

const addReplayNames = {
  source: null,
  fragments: null,
  dir: "dir",
  sandbox: "sandbox",
  yes: "yes",
  agents: "agents",
  launch: "launch",
  noLaunch: "no-launch",
} satisfies Record<keyof AddFlags, string | null>;

type Added = Effect.Success<ReturnType<typeof add>>;

/**
 * Builds the registry `add` uses for the picker, the add and its telemetry, so all three see the
 * `--dir` project's own entries rather than the current directory's.
 */
const projectRegistry = Effect.fn("add.projectRegistry")(function* (project: string) {
  const roots = yield* projectRoots(project);
  return yield* Registry.pipe(Effect.provide(Registry.layer(roots)));
});

/**
 * The fragments to apply: the named ones, or a person's picks. After a pick, prints the
 * equivalent command so it can be rerun without the picker.
 */
const chooseFragments = Effect.fn("add.chooseFragments")(function* (
  flags: AddFlags,
  project: string,
  registry: Registry["Service"],
) {
  if (flags.fragments.length) return flags.fragments;
  const picked = yield* pickAdd(project).pipe(Effect.provideService(Registry, registry));
  if (picked.length)
    yield* runningCommand(["add", ...picked, ...replayProjectFlags(addReplayNames, flags)]);
  return picked;
});

/** Records the `add` telemetry event with the settled handoff, then flushes the spool. */
const recordAdd = Effect.fn("add.recordTelemetry")(function* (input: {
  telemetry: Telemetry["Service"];
  registry: Registry["Service"];
  added: Added;
  decision: SettledHandoff;
  source: Effect.Success<ReturnType<typeof sourceValue>>;
}) {
  const { manifest, composition } = input.added;
  yield* input.telemetry.recordScaffold(
    {
      type: "add",
      manifest: settleHandoff(manifest, input.decision, manifest.createdAt),
      without: [],
      source: input.source,
      steps: officialSteps(composition),
    },
    input.registry,
  );
  yield* input.telemetry.flush;
});

export const addCommand = Command.make("add", addFlags, (flags) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const path = yield* Path.Path;
    const { json } = yield* root;
    const { source: sourceInput, dir, launch, noLaunch, fragments: requested, ...parsed } = flags;
    const source = yield* sourceValue(sourceInput);
    if (!requested.length && !(yield* promptingAllowed)) return yield* new Usage();
    const preferences = yield* prepareHandoff({ launch, noLaunch }, json);
    const project = path.resolve(
      host.cwd,
      Option.getOrElse(dir, () => "."),
    );
    const registry = yield* projectRegistry(project);
    const fragments = yield* chooseFragments(flags, project, registry);
    if (!fragments.length) return;
    const options = {
      ...parsed,
      root: project,
      fragments,
      handoff: preferences,
    };
    const added = yield* add(
      options satisfies ExactProjectOptions<typeof options, AddOptions>,
    ).pipe(Effect.provideService(Registry, registry));
    const { result, manifest } = added;
    const telemetry = yield* Telemetry;
    const output = yield* Output;
    const context = yield* handoffContext(result.project, manifest.agents[0], result.untrusted);
    const summary = renderAdd({ ...result, untrusted: context.untrusted }, context);
    const { decision, prefix } = yield* resolveChoice(added.decision, result.project, summary);
    yield* recordAdd({ telemetry, registry, added, decision, source });
    yield* annotateHandoff(decision);
    if (decision.kind !== "launch") {
      const handoff = handoffResult(decision, context.invocation);
      return yield* output.result(
        Schema.encodeSync(AddResult)({ ...result, handoff }),
        `${prefix}${renderHandoff(decision, context)}`,
      );
    }
    yield* printLaunch(decision, context.shown, prefix);
    yield* launchHandoff(decision, result.project, context);
  }).pipe(recordCommandError("add")),
).pipe(
  Command.withDescription(
    `Apply fragments to an existing repository without overwriting live files. Conflicts are parked under ${INCOMING}/ for your agent to merge; verify checks the whole project. Exits 0 on success, 2 on bad input or an unknown fragment, 3 on a bad manifest, 5 when the project's verify steps changed (VerifyChanged), 6 on permissions, 130 when interrupted; after launching a terminal agent, the agent's own status; an app launch exits 0.`,
  ),
  Command.withShortDescription("Apply fragments to an existing repository."),
  Command.withExamples(({ commandPath }) => [
    {
      command: `${commandPath.join(" ")} ci-github`,
      description: "Add CI to the current repository",
    },
    {
      command: `${commandPath.join(" ")} ci-github git-hooks --dir ../my-project --json`,
      description: "Add two fragments to another directory, as an agent would",
    },
  ]),
);
