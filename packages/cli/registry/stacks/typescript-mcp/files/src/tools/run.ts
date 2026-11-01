import type { CallToolResult } from "@modelcontextprotocol/server";
import { INTERNAL_ERROR_MESSAGE, ToolError } from "../errors.ts";
import type { Logger } from "../logging.ts";

/**
 * Runs one tool call: returns the value as structured content (with the same JSON as text for
 * clients that read only text), a ToolError as an `isError` result with its fixed message, and
 * anything else as an `isError` result with no detail. Logs one record per call, never the
 * arguments or the result.
 */
export async function runTool<T extends Record<string, unknown>>(
  logger: Logger,
  tool: string,
  call: () => Promise<T>,
): Promise<CallToolResult> {
  const started = performance.now();
  const durationMs = () => Math.round((performance.now() - started) * 10) / 10;
  try {
    const value = await call();
    logger.info({ tool, outcome: "ok", durationMs: durationMs() }, "tool call");
    return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
  } catch (error) {
    if (error instanceof ToolError) {
      logger.info(
        { tool, outcome: "tool_error", code: error.code, durationMs: durationMs() },
        "tool call",
      );
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const errorClass = error instanceof Error ? error.constructor.name : typeof error;
    logger.error({ tool, outcome: "failed", errorClass, durationMs: durationMs() }, "tool call");
    return { content: [{ type: "text", text: INTERNAL_ERROR_MESSAGE }], isError: true };
  }
}
