// Pins the public API: the names src/index.ts exports at runtime. A change here is a release
// decision (a new export is minor, a removed or renamed one is major), so update README.md's API
// section in the same change.
import { expect, test } from "vitest";
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
