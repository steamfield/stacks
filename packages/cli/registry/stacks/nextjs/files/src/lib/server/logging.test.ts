import { expect, it } from "vitest";
import { eventRecord } from "./logging";

it("emits a correlated structured record with only safe fields", () => {
  const record = eventRecord("item.added", "request-123");
  expect(record).toEqual({
    time: expect.stringMatching(/Z$/),
    level: "info",
    event: "item.added",
    requestId: "request-123",
  });
  expect(Number.isNaN(Date.parse(record.time))).toBe(false);
});
