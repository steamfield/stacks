import { expect, test } from "vitest";
import { captureLogger } from "../tests/helpers/server.ts";

test("records are flat JSON with an ISO time and a text level", () => {
  const { logger, records } = captureLogger();
  logger.info({ tool: "demo" }, "tool call");
  expect(records).toEqual([
    {
      level: "info",
      time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      tool: "demo",
      msg: "tool call",
    },
  ]);
});

test("secret-looking keys are redacted one level down", () => {
  const { logger, records } = captureLogger();
  logger.info({ token: "t", request: { authorization: "Bearer x", path: "a.md" } }, "event");
  expect(records[0]).toMatchObject({
    token: "[redacted]",
    request: { authorization: "[redacted]", path: "a.md" },
  });
});

test("the level filters records", () => {
  const { logger, records } = captureLogger("warn");
  logger.info("dropped");
  logger.warn("kept");
  expect(records.map((record) => record.msg)).toEqual(["kept"]);
});
