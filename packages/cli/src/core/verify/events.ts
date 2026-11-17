/**
 * Emits verify's live step events through `Output.event`. The `VerifyEvent` fields are a contract
 * for agents and MCP clients.
 */
import { Effect, Schema } from "effect";
import { type StepResult, VerifyEvent } from "../../schemas/verify";
import { Output } from "../../services/output";
import { printable } from "../text/text";
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

/** The finish event serves JSON readers. Human progress comes from `runStep`. */
export const stepFinished = (result: StepResult) =>
  emit({
    event: "step-finished",
    name: result.name,
    phase: result.phase,
    status: result.status,
    ...(result.failureKind === undefined ? {} : { failureKind: result.failureKind }),
    durationMs: result.durationMs,
  });
