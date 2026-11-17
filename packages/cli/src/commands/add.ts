/** Handles `stacks add` and records telemetry after the handoff settles. */
import { Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { add } from "../core/add";
import { renderAdd } from "../core/add/report";
import { type HandoffDecision, handoffRecord } from "../core/handoff/decide";
import { completeHandoff, prepareHandoff } from "../core/handoff/run";
import { pickAdd, promptingAllowed, replayFlags, runningCommand } from "../core/prompting";
import { Registry, remoteRoots } from "../core/registry/registry";
import { Usage } from "../errors";
import { INCOMING, METADATA_DIR } from "../project-layout";
import { AddResult } from "../schemas/add";
import { Host } from "../services/host";
import { Telemetry } from "../telemetry";
import { projectFlags } from "./project-flags";
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

type Added = Effect.Success<ReturnType<typeof add>>;

/**
 * Builds the registry `add` uses for the picker, the add and its telemetry, so all three see the
 * `--dir` project's own entries rather than the current directory's.
 */
const projectRegistry = Effect.fn("add.projectRegistry")(function* (project: string) {
  const path = yield* Path.Path;
  const roots = (yield* remoteRoots).map((entry) =>
    entry.origin === "project" ? { ...entry, path: path.join(project, METADATA_DIR) } : entry,
  );
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
  if (picked.length) yield* runningCommand(["add", ...picked, ...replayAddFlags(flags)]);
  return picked;
});

function replayAddFlags(flags: AddFlags) {
  return replayFlags({
    dir: Option.getOrUndefined(flags.dir),
    sandbox: flags.sandbox,
    yes: flags.yes,
    agents: flags.agents,
    launch: Option.getOrUndefined(flags.launch),
    "no-launch": flags.noLaunch,
  });
}

/** Records the `add` telemetry event with the settled handoff, then flushes the spool. */
const recordAdd =
  (input: {
    telemetry: Telemetry["Service"];
    registry: Registry["Service"];
    added: Added;
    source: Effect.Success<ReturnType<typeof sourceValue>>;
  }) =>
  (settled: HandoffDecision) => {
    const { manifest, composition } = input.added;
    return input.telemetry
      .recordScaffold(
        {
          type: "add",
          manifest: { ...manifest, handoff: handoffRecord(settled, manifest.createdAt) },
          without: [],
          source: input.source,
          steps: officialSteps(composition),
        },
        input.registry,
      )
      .pipe(Effect.andThen(input.telemetry.flush));
  };

export const addCommand = Command.make("add", addFlags, (flags) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const path = yield* Path.Path;
    const { json } = yield* root;
    const source = yield* sourceValue(flags.source);
    if (!flags.fragments.length && !(yield* promptingAllowed)) return yield* new Usage();
    const handoff = yield* prepareHandoff(flags, json);
    const project = path.resolve(
      host.cwd,
      Option.getOrElse(flags.dir, () => "."),
    );
    const registry = yield* projectRegistry(project);
    const fragments = yield* chooseFragments(flags, project, registry);
    if (!fragments.length) return;
    const added = yield* add({
      root: project,
      fragments,
      sandbox: flags.sandbox,
      yes: flags.yes,
      agents: flags.agents.length ? flags.agents : undefined,
      handoff,
    }).pipe(Effect.provideService(Registry, registry));
    const { result, decision, manifest } = added;
    const telemetry = yield* Telemetry;
    yield* completeHandoff({
      project: result.project,
      agent: manifest.agents[0],
      untrusted: result.untrusted,
      decision,
      beforeHandoff: recordAdd({ telemetry, registry, added, source }),
      render: (context) =>
        renderAdd(
          { ...result, untrusted: context.untrusted },
          { ...context, invocation: host.invocation },
        ),
      encode: (handoff) => Schema.encodeSync(AddResult)({ ...result, handoff }),
    });
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
