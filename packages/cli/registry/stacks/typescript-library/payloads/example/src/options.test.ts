import { expect, test } from "vitest";
import { defaultOptions, resolveOptions, type SlugifyOptions } from "./options.ts";

test("no options gives the defaults", () => {
  expect(resolveOptions(undefined)).toEqual({ separator: "-", maxLength: 80, lowercase: true });
  expect(resolveOptions({})).toEqual(defaultOptions);
});

test("given options replace only their own defaults", () => {
  expect(resolveOptions({ maxLength: 20 })).toEqual({ ...defaultOptions, maxLength: 20 });
});

test.each([
  [{ separator: "" }, "separator"],
  [{ separator: "--" }, "separator"],
  [{ separator: "a" }, "separator"],
  [{ separator: " " }, "separator"],
  [{ maxLength: 0 }, "maxLength"],
  [{ maxLength: 2.5 }, "maxLength"],
  [{ maxLength: Number.NaN }, "maxLength"],
  [{ lowercase: "yes" }, "lowercase"],
  [{ maxlength: 10 }, "maxlength"],
])("%j is rejected naming %s", (options, field) => {
  expect(() => resolveOptions(options as SlugifyOptions)).toThrow(
    expect.objectContaining({ code: "invalid_option", field }),
  );
});

test("a non-object is rejected", () => {
  expect(() => resolveOptions("fast" as unknown as SlugifyOptions)).toThrow(
    expect.objectContaining({ code: "invalid_option", field: "options" }),
  );
});
