import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("uses defaults for an empty environment", () => {
    expect(loadConfig({})).toEqual({ port: 3000, logLevel: "info", maxBodyBytes: 65_536 });
  });

  it("prefers PORT_API, falls back to PORT, and treats empty values as unset", () => {
    expect(loadConfig({ PORT_API: "8080", PORT: "9000" }).port).toBe(8080);
    expect(loadConfig({ PORT: "9000" }).port).toBe(9000);
    expect(loadConfig({ PORT_API: "", PORT: "" }).port).toBe(3000);
  });

  it("reads LOG_LEVEL case-insensitively", () => {
    expect(loadConfig({ LOG_LEVEL: "DEBUG" }).logLevel).toBe("debug");
  });

  it.each([
    ["PORT_API", "eighty"],
    ["PORT_API", "70000"],
    ["LOG_LEVEL", "loud"],
    ["MAX_BODY_BYTES", "0"],
  ])("rejects %s=%s with a message naming it", (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [key]: value })).toThrow(key);
  });
});
