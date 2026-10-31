import { Effect, Logger } from "effect";
import { expect, it } from "vitest";
import { defectInfo, entry, type LogEntry, makeLogger, terminalLine } from "../src/logging.ts";

it("formats UTC, lowercase levels and scalar details without serializing arbitrary objects", () => {
  const record = entry({
    date: new Date(0),
    level: "INFO",
    message: ["ready", 7, { secret: "hidden" }],
    annotations: {
      requestId: "safe",
      token: "hidden",
      time: "collision",
      object: { secret: "hidden" },
      enabled: true,
    },
  });
  expect(record).toEqual({
    time: new Date(0).toISOString(),
    level: "info",
    msg: "ready",
    detail: ["7", "[redacted]"],
    requestId: "safe",
    token: "[redacted]",
    annotation_time: "collision",
    object: "[redacted]",
    enabled: true,
  });
  expect(terminalLine(record)).toContain("info ready");
});

it("keeps only a defect's class and stack frames", () => {
  const error = new TypeError("secret-sentinel");
  const info = defectInfo(error);
  expect(info.class).toBe("TypeError");
  expect(info.stack.length).toBeGreaterThan(0);
  expect(JSON.stringify(info)).not.toContain("secret-sentinel");
  expect(defectInfo({ secret: "hidden" })).toEqual({ class: "object", stack: [] });
});

it("converts real Effect logger inputs to captured plain records", async () => {
  const records: LogEntry[] = [];
  await Effect.runPromise(
    Effect.logInfo("ready", { secret: "hidden" }).pipe(
      Effect.annotateLogs({ authorization: "hidden", requestId: "test" }),
      Effect.provide(Logger.layer([makeLogger((record) => records.push(record))])),
    ),
  );
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    level: "info",
    msg: "ready",
    authorization: "[redacted]",
    requestId: "test",
    detail: ["[redacted]"],
  });
});

it("respects the explicit terminal color preference without changing JSON records", () => {
  const record = entry({ date: new Date(0), level: "info", message: "ready" });
  expect(terminalLine(record, true)).not.toContain("\u001b");
  expect(terminalLine(record, false)).toContain("\u001b");
  expect(JSON.stringify(record)).not.toContain("\u001b");
});
