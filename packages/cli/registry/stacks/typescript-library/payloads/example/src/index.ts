/**
 * Defines the package's public API, mapped by package.json to this file's build.
 * Every named export is documented in README.md and pinned by tests/public-api.test.ts;
 * internal helpers stay private.
 */

export { isLibraryError, LibraryError, type LibraryErrorCode } from "./errors.ts";
export type { SlugifyOptions } from "./options.ts";
export { type Result, safeSlugify, slugify } from "./slugify.ts";
