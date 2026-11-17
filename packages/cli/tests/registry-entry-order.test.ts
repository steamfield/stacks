import { expect, test } from "vitest";
import { compareEntries } from "../src/core/registry/entry";

test("entries with the same kind and id compare equal", () => {
  expect(compareEntries({ kind: "stack", id: "sample" }, { kind: "stack", id: "sample" })).toBe(0);
});
