import { expect, it } from "vitest";
import { entry } from "./logging";

it("emits scalar safe records, redacts secret keys and protects reserved fields", () => {
  const record = entry({
    date: new Date(0),
    level: "Info",
    message: ["ready", { private: "hidden" }],
    annotations: { time: "collision", token: "hidden", nested: { private: "hidden" }, count: 2 },
  });
  expect(record).toEqual({
    time: "1970-01-01T00:00:00.000Z",
    level: "info",
    msg: "ready",
    detail: ["[redacted]"],
    annotation_time: "collision",
    token: "[redacted]",
    nested: "[redacted]",
    count: 2,
  });
});

it.each(["apiKey", "API_KEY", "accessKey", "ACCESS_KEY"])("redacts %s annotations", (key) => {
  const record = entry({
    date: new Date(0),
    level: "Info",
    message: "ready",
    annotations: { [key]: "PRIVATE_SENTINEL" },
  });
  expect(record[key]).toBe("[redacted]");
  expect(JSON.stringify(record)).not.toContain("PRIVATE_SENTINEL");
});
