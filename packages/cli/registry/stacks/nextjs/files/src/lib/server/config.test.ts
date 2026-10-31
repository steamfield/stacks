import { expect, it } from "vitest";
import { readConfig } from "./config";

it("defaults the title and trims an override", () => {
  expect(readConfig({})).toEqual({ APP_TITLE: "Items" });
  expect(readConfig({ APP_TITLE: " My items " })).toEqual({
    APP_TITLE: "My items",
  });
});

it("rejects an empty title", () => {
  expect(() => readConfig({ APP_TITLE: "   " })).toThrow();
});
