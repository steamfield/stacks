import { expect, expectTypeOf, test } from "vitest";
import { defined } from "../src/core/object";

test("omits only top-level undefined values and preserves the remaining key order", () => {
  const nested = { missing: undefined };
  const fields = {
    nested,
    missing: undefined,
    empty: "",
    disabled: false,
    count: 0,
    unset: null,
  };
  const result = defined(fields);

  expect(Object.keys(result)).toEqual(["nested", "empty", "disabled", "count", "unset"]);
  expect(result).toStrictEqual({
    nested: { missing: undefined },
    empty: "",
    disabled: false,
    count: 0,
    unset: null,
  });
  expect(result.nested).toBe(nested);
  expect(fields).toHaveProperty("missing", undefined);
});

test("allows absent optional keys and retains the types of required keys", () => {
  type Fields = { name: string; count: number | undefined };
  const fields: Fields = { name: "project", count: undefined };
  const result = defined(fields);

  expect(result).toStrictEqual({ name: "project" });
  expectTypeOf(result).toExtend<{ name: string; count?: number }>();
  expectTypeOf(result).toHaveProperty("count").toEqualTypeOf<number | undefined>();
  expectTypeOf<{ name: string }>().toExtend<typeof result>();
});

test("keeps each optional field tied to its discriminant", () => {
  type Fields =
    | { kind: "count"; value: number | undefined }
    | { kind: "name"; value: string | undefined };
  const clean = (fields: Fields) => defined(fields);

  expect(clean({ kind: "count", value: undefined })).toStrictEqual({ kind: "count" });
  expect(clean({ kind: "name", value: "project" })).toStrictEqual({
    kind: "name",
    value: "project",
  });
  expectTypeOf<{ kind: "count"; value: string }>().not.toExtend<ReturnType<typeof clean>>();
});

test("accepts field records and rejects arrays and objects with prototype methods", () => {
  type Input = Parameters<typeof defined>[0];

  expectTypeOf<{ name: string }>().toExtend<Input>();
  expectTypeOf<number[]>().not.toExtend<Input>();
  expectTypeOf<Date>().not.toExtend<Input>();
});
