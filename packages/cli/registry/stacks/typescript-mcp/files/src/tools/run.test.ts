import { expect, test } from "vitest";
import { captureLogger } from "../../tests/helpers/server.ts";
import { INTERNAL_ERROR_MESSAGE, TOOL_ERRORS, ToolError } from "../errors.ts";
import { runTool } from "./run.ts";

test("a value becomes structured content and the same JSON as text", async () => {
  const { logger, records } = captureLogger();
  const result = await runTool(logger, "demo", async () => ({ answer: 42 }));
  expect(result).toEqual({
    content: [{ type: "text", text: '{"answer":42}' }],
    structuredContent: { answer: 42 },
  });
  expect(records).toEqual([
    expect.objectContaining({ msg: "tool call", tool: "demo", outcome: "ok", level: "info" }),
  ]);
});

test("a ToolError becomes an isError result with its fixed message", async () => {
  const { logger, records } = captureLogger();
  const result = await runTool(logger, "demo", async () => {
    throw new ToolError("not_found");
  });
  expect(result).toEqual({
    content: [{ type: "text", text: TOOL_ERRORS.not_found }],
    isError: true,
  });
  expect(records).toEqual([
    expect.objectContaining({ outcome: "tool_error", code: "not_found", level: "info" }),
  ]);
});

test("any other failure hides its message from the model and logs only its class", async () => {
  const { logger, records } = captureLogger();
  const result = await runTool(logger, "demo", async () => {
    throw new RangeError("/home/someone/private/path");
  });
  expect(result).toEqual({
    content: [{ type: "text", text: INTERNAL_ERROR_MESSAGE }],
    isError: true,
  });
  expect(records).toEqual([
    expect.objectContaining({ outcome: "failed", errorClass: "RangeError", level: "error" }),
  ]);
  expect(JSON.stringify(records)).not.toContain("/home/someone");
});
