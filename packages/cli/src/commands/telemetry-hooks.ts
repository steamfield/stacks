/**
 * The telemetry pieces `stacks new` and `stacks add` both need, kept here so neither command
 * imports from the other.
 *
 * `commands/new.ts` and `commands/add.ts` use the `--source` flag (how the user found stacks),
 * wrap their handlers in `recordCommandError` so a failure sends an error event, and pass
 * `officialSteps` into their scaffold event. Events go to `telemetry/` (`Telemetry`), which checks
 * consent before anything is stored. Only step names from official entries (bundled, or from the
 * official index, and trusted) are reported; a personal or project entry's step names stay on the
 * machine. Recording an error can't be interrupted and never changes the command's own failure.
 */
import { TelemetryNewEvent } from "@steamfield/stacks-format";
import { Cause, Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import type { Composition } from "../core/compose/types";
import type { Entry } from "../core/registry/entry";
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

/** Decodes `--source` against the telemetry event's allowed values. */
export const sourceValue = (value: Option.Option<string>) =>
  Option.isNone(value)
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(TelemetryNewEvent.fields.source.schema)(value.value).pipe(
        Effect.mapError(() => new BadInput({ details: { id: value.value, flag: "source" } })),
      );

/** The failures whose error event also names the stack that was asked for. */
const STACK_FAILURES = ["TargetNotEmpty", "ComposeConflict"];

/** The error code a failure reports: its tag, `Interrupted`, or `Defect` for anything else. */
function errorCode(cause: Cause.Cause<unknown>) {
  const failure = cause.reasons.find(Cause.isFailReason);
  const error = failure?.error;
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string"
  )
    return error._tag;
  return Cause.hasInterruptsOnly(cause) ? "Interrupted" : "Defect";
}

/** The stack entry an error event names, when the failure is one of `STACK_FAILURES`. */
const failedStack = Effect.fn("telemetryHooks.failedStack")(function* (
  stack: string | undefined,
  code: string,
) {
  const registry = yield* Effect.serviceOption(Registry);
  if (stack === undefined || Option.isNone(registry) || !STACK_FAILURES.includes(code))
    return undefined;
  return yield* registry.value.get("stack", stack).pipe(Effect.orElseSucceed(() => undefined));
});

/**
 * Records an error event when the command fails, with consent. Recording can neither be
 * interrupted nor change the command's own failure.
 */
export const recordCommandError = (command: "new" | "add", stack?: string) =>
  Effect.tapCause((cause: Cause.Cause<unknown>) =>
    Effect.gen(function* () {
      const telemetry = yield* Telemetry;
      if ((yield* telemetry.consent) !== "enabled") return;
      const code = errorCode(cause);
      const entry = yield* failedStack(stack, code);
      yield* telemetry.recordError({ command, code, ...(entry ? { stack: entry } : {}) });
    }).pipe(Effect.uninterruptible, Effect.ignoreCause),
  );

/** Only names from actual official entry steps can enter the verify allowlist. */
export function officialSteps(composition: Composition<Entry | null>) {
  const owners = new Set(
    [...(composition.stack ? [composition.stack] : []), ...composition.fragments]
      .filter(official)
      .map((entry) => `${entry.kind}/${entry.id}`),
  );
  return composition.verify
    .filter((step) => owners.has(`${step.owner.kind}/${step.owner.id}`))
    .map((step) => step.name);
}
