import { LibraryError } from "./errors.ts";

/** What a caller may pass. Every field is optional; `resolveOptions` fills the defaults. */
export interface SlugifyOptions {
  /** Put between words. One character that isn't a letter or digit (default "-"). */
  readonly separator?: string;
  /** Longest slug returned, cut at a word boundary where possible (default 80). */
  readonly maxLength?: number;
  /** Lowercase the result (default true). */
  readonly lowercase?: boolean;
}

export interface ResolvedOptions {
  readonly separator: string;
  readonly maxLength: number;
  readonly lowercase: boolean;
}

export const defaultOptions: ResolvedOptions = Object.freeze({
  separator: "-",
  maxLength: 80,
  lowercase: true,
});

const KNOWN = new Set(Object.keys(defaultOptions));

function invalid(field: string): LibraryError {
  return new LibraryError("invalid_option", { field });
}

/**
 * Checks a caller's options and fills the defaults. JavaScript callers get no type checking, so
 * every field is checked at runtime, and an unknown key (a typo such as `maxlength`) is an error
 * rather than silently ignored.
 */
export function resolveOptions(options: SlugifyOptions | undefined): ResolvedOptions {
  if (options === undefined) return defaultOptions;
  if (typeof options !== "object" || options === null) throw invalid("options");
  for (const key of Object.keys(options)) if (!KNOWN.has(key)) throw invalid(key);

  const { separator, maxLength, lowercase } = { ...defaultOptions, ...options };
  if (typeof separator !== "string" || !/^[^\p{L}\p{N}\s]$/u.test(separator)) {
    throw invalid("separator");
  }
  if (!Number.isInteger(maxLength) || maxLength < 1) throw invalid("maxLength");
  if (typeof lowercase !== "boolean") throw invalid("lowercase");
  return { separator, maxLength, lowercase };
}
