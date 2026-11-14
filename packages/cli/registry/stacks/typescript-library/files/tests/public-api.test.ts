// Pins the public API: the names src/index.ts exports at runtime. A change here is a release
// decision (a new export is minor, a removed or renamed one is major), so update README.md's API
// section in the same change.
import { expect, expectTypeOf, test } from "vitest";
import * as api from "../src/index.ts";

test("exports exactly the documented names", () => {
  expect(Object.keys(api).sort()).toEqual([
    "LibraryError",
    "isLibraryError",
    "safeSlugify",
    "slugify",
  ]);
});

test("the error type works through the public entry", () => {
  const result = api.safeSlugify("");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(api.isLibraryError(result.error)).toBe(true);
  expect(result.error).toBeInstanceOf(api.LibraryError);
});

// Type-level: tsc checks these (bun run typecheck), so a signature change fails the build.
test("the public signatures are what callers see", () => {
  expectTypeOf(api.slugify).toEqualTypeOf<
    (input: string, options?: api.SlugifyOptions) => string
  >();
  expectTypeOf(api.safeSlugify).returns.toEqualTypeOf<api.Result<string>>();
  expectTypeOf<api.LibraryErrorCode>().toEqualTypeOf<
    "invalid_input" | "invalid_option" | "empty_result"
  >();
});
