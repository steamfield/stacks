// The package's only entry point: package.json's "exports" maps "." to the build of this file.
// Every name exported here is public API, listed in README.md's API section and pinned by
// tests/public-api.test.ts. Export by name; never from src/internal/.
export { isLibraryError, LibraryError, type LibraryErrorCode } from "./errors.ts";
export type { SlugifyOptions } from "./options.ts";
export { type Result, safeSlugify, slugify } from "./slugify.ts";
