/**
 * Runs a verify step and returns failures as values so the runner can report them. Serving uses a
 * scoped process and checks the port afterward to catch a process that escaped its group.
 */
import type { FailureKind } from "@steamfield/stacks-format";
import { Clock, Duration, Effect, FileSystem, Path } from "effect";
import type { SpawnFailed } from "../../errors";
import type { StepResult } from "../../schemas/verify";
import { Output, stripAnsi } from "../../services/output";
import { type Finished, Processes } from "../../services/processes";
import { printable } from "../text/text";
import { type PlannedStep, stepFields } from "./plan";
import { portAnswers, portClosed, probeReady, probeTarget } from "./probe";
import { outputLine } from "./report";

export type StepContext = { root: string; realRoot: string; env: Record<string, string> };

const PIPES_HELD_REASON = "the step left a process holding its output; it was stopped after 2 s";
const EARLY_EXIT_REASON =
  "serve command exited before its probe passed; serve commands must stay in the foreground";

function parseDuration(text: string): Duration.Duration {
  const match = /^(\d+)(ms|s|m)$/.exec(text);
  const value = Number(match?.[1] ?? 0);
  if (match?.[2] === "ms") return Duration.millis(value);
  if (match?.[2] === "s") return Duration.seconds(value);
  return Duration.minutes(value);
}

/** The command a `run` names: its first word after any leading `NAME=value` assignments. */
function firstWord(run: string): string {
  const words = run.trim().split(/\s+/);
  return words.find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) ?? words[0] ?? run;
}

function spawnReason(error: SpawnFailed, cwd: string): string {
  switch (error.kind) {
    case "cwd":
      return `working directory ${cwd} not found`;
    case "shell":
      return `/bin/sh could not start (${error.errno})`;
    case "resources":
    case "command":
      return `the system refused to start a process (${error.errno})`;
  }
}

function progressLines(name: string, progress: (text: string) => Effect.Effect<void>) {
  let pending = "";
  return {
    push: (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      return Effect.forEach(lines, (line) => progress(`  ${name} | ${outputLine(line)}`), {
        discard: true,
      });
    },
    end: Effect.suspend(() =>
      pending ? progress(`  ${name} | ${outputLine(pending)}`) : Effect.void,
    ),
  };
}

/** Strip terminal escapes from the output tail before putting it in the step result. */
function stepReporter(step: PlannedStep, started: number) {
  const finish = (fields: Partial<StepResult> & Pick<StepResult, "status">) =>
    Effect.map(
      Clock.currentTimeMillis,
      (now): StepResult => ({
        ...stepFields(step),
        ...fields,
        ...(fields.outputTail === undefined ? {} : { outputTail: stripAnsi(fields.outputTail) }),
        durationMs: now - started,
      }),
    );
  const fail = (failureKind: FailureKind, reason: string, extra: Partial<StepResult> = {}) =>
    finish({ status: "failed", failureKind, reason, ...extra });
  return { finish, fail };
}
type StepReporter = ReturnType<typeof stepReporter>;

/**
 * The step's working directory as a real path inside the project, or the reason it can't run.
 * Any lookup failure reads as missing; the check fails closed, so that is safe.
 */
const stepDirectory = (step: PlannedStep, context: StepContext) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwdText = step.cwd ?? ".";
    const real = yield* Effect.option(fs.realPath(path.resolve(context.root, cwdText)));
    if (real._tag === "None") return { refused: `working directory ${cwdText} not found` };
    const inside =
      real.value === context.realRoot || real.value.startsWith(`${context.realRoot}${path.sep}`);
    if (!inside) return { refused: `working directory ${cwdText} resolves outside the project` };
    return { cwd: real.value };
  });

/**
 * Refuse a bad working directory, probe URL or occupied port before running a process. Use
 * `Processes.run` or `Processes.start` for a separate process group and closed stdin.
 */
export const runStep = (step: PlannedStep, context: StepContext) =>
  Effect.scoped(
    Effect.gen(function* () {
      const output = yield* Output;
      const report = stepReporter(step, yield* Clock.currentTimeMillis);
      yield* output.progress(`> ${printable(step.name)}: ${printable(step.run)}`);
      // Scoped: the live line clears when this step's scope closes.
      yield* output.live(printable(step.name));
      const dir = yield* stepDirectory(step, context);
      if (dir.refused !== undefined) return yield* report.fail("env", dir.refused);
      const spec = { command: step.run, cwd: dir.cwd, env: context.env };
      if (step.phase === "serve" && step.expect)
        return yield* serve({ step, spec, expect: step.expect, report });
      return yield* command({
        step,
        spec: { ...spec, timeout: parseDuration(step.timeout) },
        report,
      });
    }),
  );

type Spec = { command: string; cwd: string; env: Record<string, string> };

type CommandOptions = {
  step: PlannedStep;
  spec: Spec & { timeout: Duration.Duration };
  report: StepReporter;
};

/** Without a readiness probe, judge the step by its exit or timeout, even for a serve step. */
const command = ({ step, spec, report }: CommandOptions) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const output = yield* Output;
    const lines = progressLines(step.name, output.progress);
    const run = yield* Effect.result(processes.run(spec, lines.push));
    yield* lines.end;
    if (run._tag === "Failure")
      return yield* report.fail("env", spawnReason(run.failure, step.cwd ?? "."));
    return yield* commandResult(step, run.success, report);
  });

/**
 * Exit 127 means the shell could not find the command (`env`). `Finished.pipesHeld` records a
 * background process that held output open until `Processes.run` cleaned up.
 */
const commandResult = (step: PlannedStep, finished: Finished, report: StepReporter) => {
  const tail = finished.tail ? { outputTail: finished.tail } : {};
  const exit = { exitCode: finished.exitCode, ...tail };
  // A timed-out step's exit status is the CLI's own kill, so it isn't reported.
  if (finished.timedOut) return report.fail("timeout", `timed out after ${step.timeout}`, tail);
  if (finished.exitCode === 127)
    return report.fail("env", `command not found: ${firstWord(step.run)}`, exit);
  if (finished.exitCode !== 0) {
    const reason = finished.pipesHeld
      ? PIPES_HELD_REASON
      : `exited with status ${finished.exitCode}`;
    return report.fail("step", reason, exit);
  }
  return report.finish({
    status: "passed",
    exitCode: 0,
    ...(finished.pipesHeld ? { note: PIPES_HELD_REASON } : {}),
  });
};

type ServeEnd = { _tag: "ready" } | { _tag: "exited"; finished: Finished } | { _tag: "timeout" };

type ServeOptions = {
  step: PlannedStep;
  spec: Spec;
  expect: { http: string; within: string };
  report: StepReporter;
};

/** The server scope closes before `serveResult` checks for a closed port. */
const serve = ({ step, spec, expect, report }: ServeOptions) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const target = probeTarget(expect.http, spec.env);
    if ("reason" in target) return yield* report.fail(target.kind, target.reason);
    if (yield* portAnswers(target.host, target.port))
      return yield* report.fail("env", `port ${target.port} already in use`);
    const launched = yield* Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          const running = yield* processes.start(spec);
          const end: ServeEnd = yield* Effect.raceAllFirst([
            probeReady(target.url).pipe(Effect.as({ _tag: "ready" } as const)),
            running.exited.pipe(Effect.map((finished) => ({ _tag: "exited", finished }) as const)),
            Effect.sleep(parseDuration(expect.within)).pipe(
              Effect.as({ _tag: "timeout" } as const),
            ),
          ]);
          return { end, tail: yield* running.tail };
        }),
      ),
    );
    if (launched._tag === "Failure")
      return yield* report.fail("env", spawnReason(launched.failure, step.cwd ?? "."));
    return yield* serveResult({ ...launched.success, target, expect, report });
  });

type ServeResultOptions = {
  end: ServeEnd;
  tail: string;
  target: { host: string; port: number };
  expect: ServeOptions["expect"];
  report: StepReporter;
};

/**
 * A serve step's result from how its race ended. A server that exits before its probe passes
 * fails even with status 0, because a serve command must stay in the foreground.
 */
const serveResult = ({ end, tail, target, expect, report }: ServeResultOptions) =>
  Effect.gen(function* () {
    const output = tail ? { outputTail: tail } : {};
    switch (end._tag) {
      case "exited": {
        const { exitCode } = end.finished;
        const reason = exitCode === 0 ? EARLY_EXIT_REASON : `exited with status ${exitCode}`;
        return yield* report.fail("step", reason, { exitCode, ...output });
      }
      case "timeout":
        return yield* report.fail("timeout", `probe not ready after ${expect.within}`, output);
      case "ready":
        if (!(yield* portClosed(target.host, target.port)))
          return yield* report.fail(
            "step",
            `port ${target.port} still answering after the serve step stopped; a process left the step's process group`,
            output,
          );
        return yield* report.finish({ status: "passed" });
    }
  });
