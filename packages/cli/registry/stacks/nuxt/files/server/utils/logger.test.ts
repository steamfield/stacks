import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture(minimum: Parameters<typeof createLogger>[0]) {
  const lines: string[] = [];
  const log = createLogger(minimum, (line) => lines.push(line));
  return { lines, log };
}

describe("createLogger", () => {
  it("writes one JSON line with a UTC time and the given fields", () => {
    const { lines, log } = capture("info");
    log("info", "request", { requestId: "r1", method: "GET", status: 200 });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "");
    expect(record).toMatchObject({
      level: "info",
      event: "request",
      requestId: "r1",
      method: "GET",
      status: 200,
    });
    expect(record.time).toMatch(/Z$/);
  });

  it("drops records below the configured level", () => {
    const { lines, log } = capture("warn");
    log("info", "request");
    log("error", "unexpected-error", { errorType: "TypeError" });
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["unexpected-error"]);
  });
});
