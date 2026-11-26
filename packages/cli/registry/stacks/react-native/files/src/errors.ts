/**
 * The app's one error type and its mapping to what a person sees. Every failure that reaches a
 * screen or the error boundary passes through `toAppError` first.
 */

export type AppErrorKind =
  | "config"
  | "unavailable"
  | "timeout"
  | "native"
  | "decode"
  | "unexpected";

export class AppError extends Error {
  readonly kind: AppErrorKind;
  /** The native rejection code, when the failure came from a Turbo Module. */
  readonly code: string | undefined;
  readonly original: unknown;

  constructor(
    kind: AppErrorKind,
    message: string,
    options: { code?: string; original?: unknown } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.code = options.code;
    this.original = options.original;
  }
}

const hasCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && typeof (error as { code?: unknown }).code === "string";

/** Native promise rejections arrive as an Error with a string `code`; anything else is a bug. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (hasCode(error))
    return new AppError("native", error.message, { code: error.code, original: error });
  const message = error instanceof Error ? error.message : String(error);
  return new AppError("unexpected", message, { original: error });
}

const MESSAGES: Record<Exclude<AppErrorKind, "config">, string> = {
  unavailable: "This build doesn't include the native module for this screen.",
  timeout: "The device took too long to answer. Try again.",
  native: "The device couldn't read this information.",
  decode: "The device sent data this version of the app doesn't understand.",
  unexpected: "Something went wrong. Try again.",
};

export function userMessage(error: AppError): string {
  return error.kind === "config"
    ? `The app's settings are invalid: ${error.message}`
    : MESSAGES[error.kind];
}

/** Whether a retry can succeed without a new build. */
export function isRetryable(error: AppError): boolean {
  return error.kind === "timeout" || error.kind === "native" || error.kind === "unexpected";
}
