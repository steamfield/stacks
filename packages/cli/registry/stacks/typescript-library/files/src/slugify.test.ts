import { describe, expect, test } from "vitest";
import { LibraryError } from "./errors.ts";
import { safeSlugify, slugify } from "./slugify.ts";

describe("slugify", () => {
  test.each([
    ["Hello, World!", "hello-world"],
    ["  spaced   out  ", "spaced-out"],
    ["Crème Brûlée, 2 ways!", "creme-brulee-2-ways"],
    ["already-a-slug", "already-a-slug"],
    ["snake_case_name", "snake-case-name"],
    ["東京 タワー", "東京-タワー"],
  ])("%j becomes %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  test("uses the separator and keeps case when asked", () => {
    expect(slugify("Hello World", { separator: "_", lowercase: false })).toBe("Hello_World");
  });

  test("stops at a word boundary within maxLength", () => {
    expect(slugify("one two three", { maxLength: 9 })).toBe("one-two");
    expect(slugify("one two three", { maxLength: 7 })).toBe("one-two");
  });

  test("cuts a first word longer than maxLength", () => {
    expect(slugify("supercalifragilistic words", { maxLength: 5 })).toBe("super");
  });

  test.each([
    ["", "empty_result"],
    ["!!! ---", "empty_result"],
  ])("%j fails with %s", (input, code) => {
    expect(() => slugify(input)).toThrow(expect.objectContaining({ code }));
  });

  test("rejects a non-string input from a JavaScript caller", () => {
    const call = () => slugify(42 as unknown as string);
    expect(call).toThrow(LibraryError);
    expect(call).toThrow(expect.objectContaining({ code: "invalid_input", field: "input" }));
  });
});

describe("safeSlugify", () => {
  test("returns the slug", () => {
    expect(safeSlugify("Hello World")).toEqual({ ok: true, value: "hello-world" });
  });

  test("returns the error a throwing call would raise", () => {
    const result = safeSlugify("hello", { maxLength: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(LibraryError);
    expect(result.error.code).toBe("invalid_option");
    expect(result.error.field).toBe("maxLength");
  });

  test("lets an unexpected error through", () => {
    const options = {
      get separator(): string {
        throw new RangeError("boom");
      },
    };
    expect(() => safeSlugify("hello", options)).toThrow(RangeError);
  });
});
