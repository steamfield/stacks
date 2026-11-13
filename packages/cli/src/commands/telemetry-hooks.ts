import { TelemetryNewEvent } from "@steamfield/stacks-format";
import { Cause, Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import type { Composition } from "../core/compose/types";
import { Registry } from "../core/registry/registry";
import { BadInput } from "../errors";
import { Telemetry } from "../telemetry";
import { official } from "../telemetry/events";

export const sourceFlag = Flag.String("source").pipe(
  Flag.withDescription(
    "How you reached stacks: web, docs, skill, cli or other. Optional telemetry metadata.",
  ),
  Flag.optional,
);
export const sourceValue = (value: Option.Option<string>) =>
  Option.isNone(value)
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(TelemetryNewEvent.fields.source.schema)(value.value).pipe(
        Effect.mapError(() => new BadInput({ details: { id: value.value, flag: "source" } })),
      );
function errorTag(cause: Cause.Cause<unknown>) {
  const failure = cause.reasons.find(Cause.isFailReason);
  const value = failure?.error;
  if (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    typeof value._tag === "string"
  )
    return value._tag;
  return Cause.hasInterruptsOnly(cause) ? "Interrupted" : "Defect";
}
export const recordCommandError = (command: "new" | "add", stack?: string) =>
  Effect.tapCause((cause: Cause.Cause<unknown>) =>
    Effect.gen(function* () {
      const telemetry = yield* Telemetry;
      if ((yield* telemetry.consent) !== "enabled") return;
      const registry = yield* Effect.serviceOption(Registry);
      const tag = errorTag(cause);
      const entry =
        stack === undefined ||
        Option.isNone(registry) ||
        !["TargetNotEmpty", "ComposeConflict"].includes(tag)
          ? undefined
          : yield* registry.value.get("stack", stack).pipe(Effect.orElseSucceed(() => undefined));
      yield* telemetry.recordError({ command, code: tag, ...(entry ? { stack: entry } : {}) });
    }).pipe(Effect.uninterruptible, Effect.ignoreCause),
  );
/** Only names from actual official entry steps can enter the verify allowlist. */
export function officialSteps(
  composition: Composition<import("../core/registry/entry").Entry | null>,
) {
  const owners = new Set(
    [...(composition.stack ? [composition.stack] : []), ...composition.fragments]
      .filter(official)
      .map((entry) => `${entry.kind}/${entry.id}`),
  );
  return composition.verify
    .filter((step) => owners.has(`${step.owner.kind}/${step.owner.id}`))
    .map((step) => step.name);
}
