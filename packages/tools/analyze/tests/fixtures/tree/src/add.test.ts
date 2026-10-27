import { describe, expect, test } from "vitest";
import { add } from "./add";

describe("add", () => {
  test("adds two numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
});
