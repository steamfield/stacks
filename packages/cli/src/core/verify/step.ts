import type { FailureKind } from "@steamfield/stacks-format";
import { Clock, Duration, Effect, FileSystem, Path } from "effect";
import type { SpawnFailed } from "../../errors";
import type { StepResult } from "../../schemas/verify";
import { Output, stripAnsi } from "../../services/output";
import { type Finished, Processes } from "../../services/processes";
import { printable } from "../text";
import type { PlannedStep } from "./plan";
import { portAnswers, portClosed, probeReady, probeTarget } from "./probe";
import { outputLine } from "./report";

/** Where steps run: the project root as found, its real path, and the step environment. */
export type StepContext = { root: string; realRoot: string; env: Record<string, string> };

export const PIPES_HELD_REASON =
  "the step left a process holding its output; it was stopped after 2 s";
const EARLY_EXIT_REASON =
  "serve command exited before its probe passed; serve commands must stay in the foreground";

/** "500ms", "90s", "10m" (the entry format's duration pattern). */
export function parseDuration(text: string): Duration.Duration {
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

/** Output lines, prefixed with the step name, as live progress (human mode only). */
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

/**
 * Runs one step and reports it; never fails. A step whose `cwd` is missing or resolves outside
 * the project, or (serve) whose probe URL is wrong or whose port is taken, fails without running.
 */
export const runStep = (step: PlannedStep, context: StepContext) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const output = yield* Output;
      const started = yield* Clock.currentTimeMillis;
      const base = {
        name: step.name,
        phase: step.phase,
        ...(step.layer ? { layer: step.layer } : {}),
        command: step.run,
      };
      const result = (fields: Partial<StepResult> & Pick<StepResult, "status">) =>
        Effect.map(
          Clock.currentTimeMillis,
          (now): StepResult => ({
            ...base,
            ...fields,
            ...(fields.outputTail === undefined
              ? {}
              : { outputTail: stripAnsi(fields.outputTail) }),
            durationMs: now - started,
          }),
        );
      const fail = (failureKind: FailureKind, reason: string, extra: Partial<StepResult> = {}) =>
        result({ status: "failed", failureKind, reason, ...extra });

      yield* output.progress(`> ${printable(step.name)}: ${printable(step.run)}`);
      yield* output.live(printable(step.name));
      const cwdText = step.cwd ?? ".";
      const dir = path.resolve(context.root, cwdText);
      const real = yield* Effect.option(fs.realPath(dir));
      if (real._tag === "None") return yield* fail("env", `working directory ${cwdText} not found`);
      const inside =
        real.value === context.realRoot || real.value.startsWith(`${context.realRoot}${path.sep}`);
      if (!inside)
        return yield* fail("env", `working directory ${cwdText} resolves outside the project`);
      const spec = { command: step.run, cwd: real.value, env: context.env };
      return yield* step.phase === "serve" && step.expect
        ? serve({ step, spec, expect: step.expect, fail, result })
        : command({
            step,
            spec: { ...spec, timeout: parseDuration(step.timeout) },
            cwdText,
            fail,
            result,
          });
    }),
  );

type Report = (
  failureKind: FailureKind,
  reason: string,
  extra?: Partial<StepResult>,
) => Effect.Effect<StepResult>;
type Pass = (fields: Partial<StepResult> & Pick<StepResult, "status">) => Effect.Effect<StepResult>;
type Spec = { command: string; cwd: string; env: Record<string, string> };

type CommandOptions = {
  step: PlannedStep;
  spec: Spec & { timeout: Duration.Duration };
  cwdText: string;
  fail: Report;
  result: Pass;
};
const command = ({ step, spec, cwdText, fail, result }: CommandOptions) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const output = yield* Output;
    const lines = progressLines(step.name, output.progress);
    const run = yield* Effect.result(processes.run(spec, lines.push));
    yield* lines.end;
    if (run._tag === "Failure") return yield* fail("env", spawnReason(run.failure, cwdText));
    const finished: Finished = run.success;
    const tail = finished.tail ? { outputTail: finished.tail } : {};
    const exit = { exitCode: finished.exitCode, ...tail };
    // A timed-out step's exit status is the CLI's own kill, so it isn't reported.
    if (finished.timedOut) return yield* fail("timeout", `timed out after ${step.timeout}`, tail);
    if (finished.exitCode === 127)
      return yield* fail("env", `command not found: ${firstWord(step.run)}`, exit);
    if (finished.exitCode !== 0)
      return yield* fail(
        "step",
        finished.pipesHeld ? PIPES_HELD_REASON : `exited with status ${finished.exitCode}`,
        exit,
      );
    return yield* result({
      status: "passed",
      exitCode: 0,
      ...(finished.pipesHeld ? { note: PIPES_HELD_REASON } : {}),
    });
  });

type ServeEnd = { _tag: "ready" } | { _tag: "exited"; finished: Finished } | { _tag: "timeout" };

type ServeOptions = {
  step: PlannedStep;
  spec: Spec;
  expect: { http: string; within: string };
  fail: Report;
  result: Pass;
};
const serve = ({ step, spec, expect, fail, result }: ServeOptions) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const target = probeTarget(expect.http, spec.env);
    if ("reason" in target) return yield* fail(target.kind, target.reason);
    if (yield* portAnswers(target.host, target.port))
      return yield* fail("env", `port ${target.port} already in use`);
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
      return yield* fail("env", spawnReason(launched.failure, step.cwd ?? "."));
    return yield* serveResult({ ...launched.success, target, expect, fail, result });
  });

type ServeResultOptions = {
  end: ServeEnd;
  tail: string;
  target: { host: string; port: number };
  expect: ServeOptions["expect"];
  fail: Report;
  result: Pass;
};
const serveResult = ({ end, tail, target, expect, fail, result }: ServeResultOptions) =>
  Effect.gen(function* () {
    const output = tail ? { outputTail: tail } : {};
    switch (end._tag) {
      case "exited":
        return end.finished.exitCode === 0
          ? yield* fail("step", EARLY_EXIT_REASON, { exitCode: 0, ...output })
          : yield* fail("step", `exited with status ${end.finished.exitCode}`, {
              exitCode: end.finished.exitCode,
              ...output,
            });
      case "timeout":
        return yield* fail("timeout", `probe not ready after ${expect.within}`, output);
      case "ready":
        if (!(yield* portClosed(target.host, target.port)))
          return yield* fail(
            "step",
            `port ${target.port} still answering after the serve step stopped; a process left the step's process group`,
            output,
          );
        return yield* result({ status: "passed" });
    }
  });
