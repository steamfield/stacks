/**
 * Checks the base error contract before the library gains its first public API.
 * These unit tests pin error context and recognition across installed copies.
 */

import { expect, test } from "vitest";
import { isLibraryError, LibraryError } from "./errors.ts";

test("carries its code, field and cause", () => {
  const cause = new Error("root");
  const error = new LibraryError("invalid_input", { field: "input", cause });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("LibraryError");
  expect(error.code).toBe("invalid_input");
  expect(error.field).toBe("input");
  expect(error.message).toBe("An argument has an invalid value. (input)");
  expect(error.cause).toBe(cause);
});

test("has a fixed message without a field", () => {
  const error = new LibraryError("invalid_input");
  expect(error.message).toBe("An argument has an invalid value.");
  expect(error.field).toBeUndefined();
  expect("cause" in error).toBe(false);
});

test("isLibraryError recognizes a copy from another install by name and code", () => {
  const copy = Object.assign(new Error("x"), { name: "LibraryError", code: "invalid_input" });
  expect(isLibraryError(new LibraryError("invalid_input"))).toBe(true);
  expect(isLibraryError(copy)).toBe(true);
});

test.each([
  ["a plain error", new Error("x")],
  ["an unknown code", Object.assign(new Error("x"), { name: "LibraryError", code: "nope" })],
  ["an inherited code", Object.assign(new Error("x"), { name: "LibraryError", code: "toString" })],
  ["a plain object", { name: "LibraryError", code: "invalid_input" }],
  ["undefined", undefined],
])("isLibraryError rejects %s", (_label, value) => {
  expect(isLibraryError(value)).toBe(false);
});
