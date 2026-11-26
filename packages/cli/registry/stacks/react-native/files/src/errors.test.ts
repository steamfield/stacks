import { AppError, isRetryable, toAppError, userMessage } from "./errors";

describe("toAppError", () => {
  test("keeps an AppError as it is", () => {
    const error = new AppError("timeout", "slow");
    expect(toAppError(error)).toBe(error);
  });

  test("maps a native rejection's code", () => {
    const rejection = Object.assign(new Error("Info.plist has no CFBundleVersion."), {
      code: "E_APP_INFO_MISSING_KEY",
    });
    const error = toAppError(rejection);
    expect(error.kind).toBe("native");
    expect(error.code).toBe("E_APP_INFO_MISSING_KEY");
    expect(error.original).toBe(rejection);
  });

  test.each([new Error("boom"), "boom", 42])("treats %p as unexpected", (thrown) => {
    expect(toAppError(thrown).kind).toBe("unexpected");
  });
});

describe("userMessage and isRetryable", () => {
  test.each([
    ["config", false],
    ["unavailable", false],
    ["decode", false],
    ["timeout", true],
    ["native", true],
    ["unexpected", true],
  ] as const)("%s retryable: %s", (kind, retryable) => {
    const error = new AppError(kind, "detail");
    expect(isRetryable(error)).toBe(retryable);
    expect(userMessage(error)).not.toBe("");
  });

  test("config errors show which setting is wrong", () => {
    expect(userMessage(new AppError("config", "nativeTimeoutMs: Too small"))).toBe(
      "The app's settings are invalid: nativeTimeoutMs: Too small",
    );
  });
});
