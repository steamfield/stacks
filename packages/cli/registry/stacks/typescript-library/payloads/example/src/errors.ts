/**
 * Why a call failed. Each code is public API: callers branch on it, so renaming or removing one
 * is a breaking change, and adding one is a minor release.
 */
export type LibraryErrorCode = "invalid_input" | "invalid_option" | "empty_result";

const messages: Record<LibraryErrorCode, string> = {
  invalid_input: "Expected a string to slugify.",
  invalid_option: "An option has an invalid value.",
  empty_result: "The input has no letters or digits to build a slug from.",
};

export interface LibraryErrorOptions {
  /** Which argument or option was wrong, such as "maxLength". Never the value itself. */
  readonly field?: string;
  readonly cause?: unknown;
}

/** The one error this package throws on purpose. Anything else escaping a call is a bug. */
export class LibraryError extends Error {
  override readonly name = "LibraryError";
  readonly code: LibraryErrorCode;
  readonly field: string | undefined;

  constructor(code: LibraryErrorCode, options: LibraryErrorOptions = {}) {
    super(
      options.field ? `${messages[code]} (${options.field})` : messages[code],
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    this.field = options.field;
  }
}

/**
 * True for a LibraryError from any copy of this package. Prefer it to `instanceof`, which fails
 * when an app ends up with two installed versions of the package.
 */
export function isLibraryError(value: unknown): value is LibraryError {
  if (!(value instanceof Error) || value.name !== "LibraryError") return false;
  const code: unknown = (value as { code?: unknown }).code;
  return typeof code === "string" && Object.hasOwn(messages, code);
}
