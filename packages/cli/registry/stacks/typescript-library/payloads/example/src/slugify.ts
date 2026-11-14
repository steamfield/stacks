import { isLibraryError, LibraryError } from "./errors.ts";
import { joinWithin, words } from "./internal/words.ts";
import { resolveOptions, type SlugifyOptions } from "./options.ts";

/** The outcome of a `safe*` call: the value, or the LibraryError the throwing form would raise. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LibraryError };

/**
 * Turns text into a URL-safe slug: "Crème Brûlée, 2 ways!" becomes "creme-brulee-2-ways".
 *
 * @throws {LibraryError} `invalid_input` when `input` isn't a string, `invalid_option` for a bad
 * option, `empty_result` when the input has no letters or digits.
 */
export function slugify(input: string, options?: SlugifyOptions): string {
  if (typeof input !== "string") throw new LibraryError("invalid_input", { field: "input" });
  const { separator, maxLength, lowercase } = resolveOptions(options);
  const list = words(lowercase ? input.toLowerCase() : input);
  if (list.length === 0) throw new LibraryError("empty_result");
  return joinWithin(list, separator, maxLength);
}

/** `slugify` that returns its failure instead of throwing it. Bugs still throw. */
export function safeSlugify(input: unknown, options?: SlugifyOptions): Result<string> {
  try {
    return { ok: true, value: slugify(input as string, options) };
  } catch (error) {
    if (isLibraryError(error)) return { ok: false, error };
    throw error;
  }
}
