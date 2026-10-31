import { Cause, Schema } from "effect";
import { CliError } from "effect/cli";

export class Usage extends Schema.TaggedError<Usage>()("Usage", {}) {}
export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("InvalidConfig", {}) {}
export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()(
  "PermissionDenied",
  {},
) {}
export class BrokenPipe extends Schema.TaggedError<BrokenPipe>()("BrokenPipe", {}) {}
export class Interrupted extends Schema.TaggedError<Interrupted>()("Interrupted", {}) {}
export class Defect extends Schema.TaggedError<Defect>()("Defect", {}) {}

export const errorClasses = [
  Usage,
  InvalidConfig,
  PermissionDenied,
  BrokenPipe,
  Interrupted,
  Defect,
] as const;
export type AppError = InstanceType<(typeof errorClasses)[number]>;
export const errorTable = {
  Usage: { code: 2, message: "Invalid command. Run --help for usage.", retryable: false },
  InvalidConfig: {
    code: 3,
    message: "Invalid configuration. Check config.json and environment settings.",
    retryable: false,
  },
  PermissionDenied: {
    code: 6,
    message: "Permission denied. Check file permissions.",
    retryable: false,
  },
  BrokenPipe: { code: 0, message: "Output pipe closed.", retryable: false },
  Interrupted: { code: 130, message: "Interrupted.", retryable: false },
  Defect: { code: 1, message: "Internal error.", retryable: false },
} as const satisfies Record<
  AppError["_tag"],
  { code: number; message: string; retryable: boolean }
>;
export const ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    tag: Schema.Literals([
      "Usage",
      "InvalidConfig",
      "PermissionDenied",
      "BrokenPipe",
      "Interrupted",
      "Defect",
    ]),
    message: Schema.String,
    retryable: Schema.Boolean,
  }),
});
export const exitCodeFor = (error: AppError) => errorTable[error._tag].code;
export const retryableFor = (error: AppError) => errorTable[error._tag].retryable;
export const errorEnvelope = (error: AppError): typeof ErrorEnvelope.Type => ({
  error: {
    tag: error._tag,
    message: errorTable[error._tag].message,
    retryable: retryableFor(error),
  },
});

export function failure(cause: Cause.Cause<unknown>): AppError {
  if (Cause.hasInterruptsOnly(cause)) return new Interrupted();
  if (cause.reasons.some(Cause.isDieReason)) return new Defect();
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    for (const ErrorClass of errorClasses)
      if (reason.error instanceof ErrorClass) return reason.error;
    if (CliError.isCliError(reason.error)) return new Usage();
  }
  return new Defect();
}
