/**
 * The `runs` command: summarizes how the current project's `stacks verify` runs have gone, from its
 * run history, its state record (the per-project file outside the project holding first-green
 * times) and the `## Asked` list in `.stacks/NOTES.md`.
 *
 * `core/runs.ts::projectRuns` finds the nearest project and reads all three; `renderRuns` writes the
 * text. This file connects them to the working directory and the output.
 */
import { Effect, Schema } from "effect";
import { Command } from "effect/cli";
import { projectRuns, renderRuns } from "../core/runs";
import { ProjectRuns } from "../schemas/runs";
import { Host } from "../services/host";
import { Output } from "../services/output";

export const runsCommand = Command.make("runs", {}, () =>
  Effect.gen(function* () {
    const host = yield* Host;
    const runs = yield* projectRuns(host.cwd);
    yield* (yield* Output).result(Schema.encodeSync(ProjectRuns)(runs), renderRuns(runs));
  }),
).pipe(
  Command.withDescription(
    "Show this project's verify history, timings and interventions, from its run records, state record and NOTES.md. Exits 0, 2 outside a project, 3 on a manifest that doesn't decode or a manifest or state record from a newer stacks, 6 when the manifest or run history can't be read, 130 when interrupted.",
  ),
  Command.withShortDescription("Show this project's verify history and timings."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Summarize the nearest project's runs" },
    {
      command: `${commandPath.join(" ")} --json`,
      description: "Get one ProjectRuns object",
    },
  ]),
);
