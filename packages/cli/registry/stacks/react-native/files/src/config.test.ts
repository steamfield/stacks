import { defaultConfig, loadConfig } from "./config";
import { AppError } from "./errors";

describe("loadConfig", () => {
  test("uses debug logging in development and info in release", () => {
    expect(loadConfig(undefined, true)).toEqual({ logLevel: "debug", nativeTimeoutMs: 5_000 });
    expect(loadConfig({}, false)).toEqual(defaultConfig(false));
    expect(defaultConfig(false).logLevel).toBe("info");
  });

  test("applies valid overrides over the defaults", () => {
    expect(loadConfig({ logLevel: "warn", nativeTimeoutMs: 250 }, true)).toEqual({
      logLevel: "warn",
      nativeTimeoutMs: 250,
    });
  });

  test.each([
    [{ nativeTimeoutMs: 0 }, "nativeTimeoutMs"],
    [{ nativeTimeoutMs: "fast" }, "nativeTimeoutMs"],
    [{ logLevel: "verbose" }, "logLevel"],
    [{ logleve: "debug" }, "logleve"],
  ])("rejects %j and names the setting", (raw, name) => {
    expect.assertions(3);
    try {
      loadConfig(raw, false);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).kind).toBe("config");
      expect((error as AppError).message).toContain(name);
    }
  });
});
