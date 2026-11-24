/**
 * Tests for the shell's error reporter: what it records, logs and puts on the banner.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { configureLogging, type LogEntry } from "./core/index.ts";
import { createErrorReporter, type RecordedError } from "./report-error.ts";

let logged: LogEntry[];
let errors: RecordedError[];
let banners: string[];
let report: ReturnType<typeof createErrorReporter>;

beforeEach(() => {
  logged = [];
  errors = [];
  banners = [];
  configureLogging((entry) => logged.push(entry));
  report = createErrorReporter(errors, (line) => banners.push(line));
});

describe("reportError", () => {
  it("records, logs and shows a banner by default", () => {
    report("webgl", "WebGL context lost");
    expect(errors).toEqual([{ source: "webgl", message: "WebGL context lost" }]);
    expect(logged).toEqual([
      { level: "error", namespace: "kit:shell", message: "webgl: WebGL context lost" },
    ]);
    expect(banners).toEqual(["webgl: WebGL context lost"]);
  });

  it("records and logs a non-fatal error without a banner", () => {
    report("asset", new Error("model 404"), { fatal: false });
    expect(errors).toEqual([{ source: "asset", message: expect.stringMatching(/^model 404\n/) }]);
    expect(logged).toEqual([
      {
        level: "error",
        namespace: "kit:shell",
        message: expect.stringMatching(/^asset: model 404\n/),
      },
    ]);
    expect(banners).toEqual([]);
  });

  it("puts only an Error's first line on the banner", () => {
    report("start", new Error("boot failed"), { fatal: true });
    expect(banners).toEqual(["start: boot failed"]);
    expect(errors[0]?.message).toContain("boot failed\nError: boot failed");
  });
});
