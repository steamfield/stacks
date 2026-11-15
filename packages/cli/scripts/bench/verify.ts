import { RunRecord } from "@steamfield/stacks-format";
import { Duration, Effect, FileSystem, Path, Schema } from "effect";
import { countAsked } from "../../src/core/runs";
import { ProjectRuns } from "../../src/schemas/runs";
import { type Captured, Processes } from "../../src/services/processes";
import type { Prepared } from "./prepare";
import type { AgentRun } from "./run";

export const verify = (prepared: Prepared) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processes = yield* Processes;
    const readOptional = (file: string) =>
      fs
        .readFileString(file)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound" || error.reason._tag === "BadResource"
              ? Effect.succeed(null)
              : Effect.fail(error),
          ),
        );
    const historyFile = path.join(prepared.project, ".stacks/state/runs.jsonl");
    const before = (yield* readOptional(historyFile)) ?? "";
    const checked = yield* processes.exec({
      argv: [prepared.cli, "verify", "--all", "--json"],
      cwd: prepared.project,
      env: prepared.env,
    });
    yield* fs.writeFileString(path.join(prepared.bench, "verify-result.json"), checked.stdout);
    const summarized = yield* processes.exec({
      argv: [prepared.cli, "runs", "--json"],
      cwd: prepared.project,
      env: prepared.env,
      timeout: Duration.seconds(60),
    });
    const summary = yield* readSummary(summarized);
    const history = (yield* readOptional(historyFile)) ?? "";
    const lines = history.trim().split(/\r?\n/).filter(Boolean);
    const run = yield* latestRun(history, before, lines);
    const notes = yield* readOptional(path.join(prepared.project, ".stacks/NOTES.md"));
    const log = yield* readOptional(path.join(prepared.bench, "verify.log"));
    return {
      run,
      notes,
      verifyRuns: Math.max(0, (summary?.verifyRuns ?? 0) - (run ? 1 : 0)),
      wrapperCalls: log?.split(/\r?\n/).filter(Boolean).length ?? 0,
      minutesToGreen: summary?.minutesToGreen ?? null,
      minutesToFirstTest: summary?.minutesToFirstTest ?? null,
      minutesToBase: firstGreenBase(lines),
      interventions:
        notes === null ? null : countAsked(notes) + (prepared.options.existing ? 1 : 0),
    };
  });

export type Verified = Effect.Success<ReturnType<typeof verify>>;

export function classify(agent: AgentRun, verified: Verified) {
  if (agent.ended === "error" && agent.unchanged) return "infra";
  return agent.ended === "exit" &&
    verified.run?.outcome === "green" &&
    verified.run.tamperCheck === "full"
    ? "pass"
    : "fail";
}

function firstGreenBase(lines: string[]): number | null {
  let minutesToBase: number | null = null;
  for (const line of lines) {
    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(RunRecord))(line);
    if (decoded._tag === "Success" && decoded.success.stages?.base === "green") {
      minutesToBase = decoded.success.secondsSinceCreated / 60;
      break;
    }
  }
  return minutesToBase;
}

const readSummary = (summarized: Captured) =>
  summarized.exitCode === 0 && !summarized.truncated
    ? Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectRuns))(summarized.stdout)
    : Effect.succeed(null);

const latestRun = (history: string, before: string, lines: string[]) => {
  const last = lines.at(-1);
  return history !== before && last
    ? Schema.decodeUnknownEffect(Schema.fromJsonString(RunRecord))(last)
    : Effect.succeed(null);
};
