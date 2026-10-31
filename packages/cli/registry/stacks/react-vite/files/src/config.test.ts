import { describe, expect, test } from "vitest";
import { ConfigError, parseConfig } from "./config";

describe("parseConfig", () => {
  test("defaults to the same-origin /api base and info logs", () => {
    expect(parseConfig({})).toEqual({ apiUrl: "/api", logLevel: "info" });
  });

  test("treats an empty value as unset", () => {
    expect(parseConfig({ VITE_API_URL: "", VITE_LOG_LEVEL: "" })).toEqual({
      apiUrl: "/api",
      logLevel: "info",
    });
  });

  test("accepts an absolute API URL and drops its trailing slash", () => {
    expect(parseConfig({ VITE_API_URL: "https://api.example.com/v1/" }).apiUrl).toBe(
      "https://api.example.com/v1",
    );
  });

  test.each([
    ["VITE_API_URL", "api.example.com"],
    ["VITE_API_URL", "ftp://example.com"],
    ["VITE_LOG_LEVEL", "verbose"],
  ])("rejects %s=%s with a message naming the variable", (name, value) => {
    expect(() => parseConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => parseConfig({ [name]: value })).toThrow(name);
  });
});
