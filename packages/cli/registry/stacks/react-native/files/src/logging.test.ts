import { createLogger, type LogRecord } from "./logging";

describe("createLogger", () => {
  const now = () => new Date("2030-01-02T03:04:05.000Z");

  test("writes flat records at or above its level", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ level: "info", sink: (r) => records.push(r), now });

    logger.debug("skipped");
    logger.info("app_info.loaded", { attempt: 1 });
    logger.error("render.failed", { kind: "unexpected" });

    expect(records).toEqual([
      { level: "info", event: "app_info.loaded", time: "2030-01-02T03:04:05.000Z", attempt: 1 },
      {
        level: "error",
        event: "render.failed",
        time: "2030-01-02T03:04:05.000Z",
        kind: "unexpected",
      },
    ]);
  });

  test("fields can't overwrite the level, event or time", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ level: "debug", sink: (r) => records.push(r), now });

    logger.warn("real", { level: "debug", event: "fake" });

    expect(records[0]).toMatchObject({ level: "warn", event: "real" });
  });

  test("writes one JSON line per record to the console by default", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createLogger({ level: "warn", now }).warn("app_info.failed", { kind: "timeout" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
        level: "warn",
        event: "app_info.failed",
        kind: "timeout",
      });
    } finally {
      warn.mockRestore();
    }
  });
});
