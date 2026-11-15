/**
 * The live events `stacks verify` emits while it runs, so a caller can follow a long run.
 *
 * `run.ts` calls `stepStarted` before each step and `stepFinished` after it. Both go through
 * `Output.event`, which renders them by audience: with `--json`, one JSON line per event on stderr
 * (the `VerifyEvent` shape, printed by `stacks schema verify-event`, which agents and the MCP
 * server parse, so its fields are a contract); for an agent, a short `> name` line when a step
 * starts; for a person, nothing, since the human view has its own live progress line.
 */
import { Effect, Schema } from "effect";
import { type StepResult, VerifyEvent } from "../../schemas/verify";
import { Output } from "../../services/output";
import { printable } from "../text";
import type { PlannedStep } from "./plan";

const emit = (event: VerifyEvent, agentText?: string) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.event(Schema.encodeSync(VerifyEvent)(event), agentText);
  });

/**
 * A step is about to run: a `step-started` event for `--json`, and one `> name` line for an
 * agent, so a run that times out or runs in the background shows which step it is on.
 */
export const stepStarted = (step: PlannedStep) =>
  emit({ event: "step-started", name: step.name, phase: step.phase }, `> ${printable(step.name)}`);

/** A step ended: a `step-finished` event for `--json` only. */
export const stepFinished = (result: StepResult) =>
  emit({
    event: "step-finished",
    name: result.name,
    phase: result.phase,
    status: result.status,
    ...(result.failureKind === undefined ? {} : { failureKind: result.failureKind }),
    durationMs: result.durationMs,
  });
