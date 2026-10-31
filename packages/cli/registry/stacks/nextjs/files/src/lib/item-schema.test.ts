import { describe, expect, it } from "vitest";
import { parseItem } from "./item-schema";

describe("item input", () => {
  it("trims a valid name and accepts the length boundary", () => {
    const form = new FormData();
    form.set("name", "  Read a book  ");
    expect(parseItem(form)).toEqual({
      status: "valid",
      data: { name: "Read a book" },
    });
    form.set("name", "a".repeat(80));
    expect(parseItem(form).status).toBe("valid");
  });

  it.each([
    [null, "Enter an item name."],
    ["", "Enter an item name."],
    ["   ", "Enter an item name."],
    ["x".repeat(81), "Use at most 80 characters."],
  ])(
    "returns the exact field error and submitted value for %j",
    (name, message) => {
      const form = new FormData();
      if (name !== null) form.set("name", name);
      expect(parseItem(form)).toEqual({
        status: "invalid",
        state: {
          status: "error",
          values: { name: name ?? "" },
          error: { code: "INVALID_INPUT", fields: { name: message } },
        },
      });
    },
  );

  it("rejects a file in a text field", () => {
    const form = new FormData();
    form.set("name", new File(["name"], "name.txt"));
    expect(parseItem(form)).toMatchObject({
      status: "invalid",
      state: { error: { fields: { name: "Enter an item name." } } },
    });
  });
});
