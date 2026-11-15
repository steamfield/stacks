/**
 * Pins the public entry's runtime exports and TypeScript signatures for library callers.
 * Changes here accompany README.md API updates and a release decision: new exports are minor,
 * while removed or renamed exports are major.
 */

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

// A negative type test: tsc fails the `@ts-expect-error` line once it compiles, so a signature that
// starts accepting a number fails `bun run typecheck` before release. The runtime check still holds.
test("the public signatures refuse what callers must not pass", () => {
  // @ts-expect-error slugify takes a string, never a number
  expect(() => api.slugify(42)).toThrow(api.LibraryError);
});
