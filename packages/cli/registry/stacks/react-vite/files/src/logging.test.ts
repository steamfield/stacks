import { afterEach, expect, test, vi } from "vitest";
import { createLogger } from "./logging";

const now = () => new Date("2026-01-02T03:04:05.000Z");

afterEach(() => vi.restoreAllMocks());

test("writes one structured record through the matching console method", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  createLogger("info", now).warn("api_error", { path: "/items", status: 500 });
  expect(warn).toHaveBeenCalledExactlyOnceWith({
    level: "warn",
    event: "api_error",
    time: "2026-01-02T03:04:05.000Z",
    path: "/items",
    status: 500,
  });
});

test("drops records below the configured level", () => {
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const logger = createLogger("warn", now);
  logger.debug("skipped");
  logger.info("skipped");
  expect(debug).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalled();
});

test("silent drops everything", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  createLogger("silent", now).error("skipped");
  expect(error).not.toHaveBeenCalled();
});

test("fields can't overwrite the level, event or time", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  createLogger("debug", now).info("real", { event: "fake", level: "error" });
  expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: "real", level: "info" }));
});
