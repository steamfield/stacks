import { Cause, Schema } from "effect";

export class BadInput extends Schema.TaggedError<BadInput>()("BadInput", {}) {
  override readonly message = errorTable.BadInput.message;
}
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {}) {
  override readonly message = errorTable.NotFound.message;
}
export class UnsupportedMediaType extends Schema.TaggedError<UnsupportedMediaType>()(
  "UnsupportedMediaType",
  {},
) {
  override readonly message = errorTable.UnsupportedMediaType.message;
}
export class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", {}) {
  override readonly message = errorTable.Unavailable.message;
}
export class PayloadTooLarge extends Schema.TaggedError<PayloadTooLarge>()("PayloadTooLarge", {}) {
  override readonly message = errorTable.PayloadTooLarge.message;
}
export type AppError = BadInput | NotFound | UnsupportedMediaType | Unavailable | PayloadTooLarge;
export const errorTable = {
  BadInput: { status: 400, message: "Invalid request.", retryable: false },
  NotFound: { status: 404, message: "Resource not found.", retryable: false },
  UnsupportedMediaType: { status: 415, message: "Unsupported content type.", retryable: false },
  Unavailable: { status: 503, message: "Service unavailable.", retryable: true },
  PayloadTooLarge: { status: 413, message: "Request body is too large.", retryable: false },
  Defect: { status: 500, message: "Internal server error.", retryable: true },
} as const;
export const statusFor = (error: AppError) => errorTable[error._tag].status;
export const retryableFor = (error: AppError) => errorTable[error._tag].retryable;

export function failure(cause: Cause.Cause<unknown>) {
  // A defect from a finalizer takes precedence over an expected failure.
  for (const reason of cause.reasons) {
    if (Cause.isDieReason(reason)) return { ...errorTable.Defect, defect: reason.defect };
  }
  if (Cause.hasInterruptsOnly(cause)) return errorTable.Unavailable;
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (
      error instanceof BadInput ||
      error instanceof NotFound ||
      error instanceof UnsupportedMediaType ||
      error instanceof Unavailable ||
      error instanceof PayloadTooLarge
    ) {
      return {
        status: statusFor(error),
        message: errorTable[error._tag].message,
        retryable: retryableFor(error),
      };
    }
  }
  const reason = cause.reasons.find(Cause.isFailReason);
  return { ...errorTable.Defect, defect: reason?.error };
}
