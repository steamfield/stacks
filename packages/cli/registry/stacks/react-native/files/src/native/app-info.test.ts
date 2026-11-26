import { AppError } from "../errors";
import { readAppInfo } from "./app-info";

const info = {
  appName: "Field Notes",
  appVersion: "2.4",
  buildNumber: "17",
  systemName: "iOS",
  systemVersion: "1.2.3",
};

const rejectWith = (error: unknown) => ({ getAppInfo: () => Promise.reject(error) });

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected readAppInfo to fail");
}

describe("readAppInfo", () => {
  test("decodes the native answer", async () => {
    await expect(
      readAppInfo({ timeoutMs: 1_000, source: { getAppInfo: async () => info } }),
    ).resolves.toEqual(info);
  });

  test("reports a build without the native module as unavailable", async () => {
    expect((await failure(readAppInfo({ timeoutMs: 1_000, source: null }))).kind).toBe(
      "unavailable",
    );
  });

  test("keeps the code of a native rejection", async () => {
    const rejection = Object.assign(new Error("Info.plist has no CFBundleVersion."), {
      code: "E_APP_INFO_MISSING_KEY",
    });
    const error = await failure(readAppInfo({ timeoutMs: 1_000, source: rejectWith(rejection) }));
    expect(error).toMatchObject({ kind: "native", code: "E_APP_INFO_MISSING_KEY" });
  });

  test("rejects an answer with a missing field", async () => {
    const { buildNumber: _dropped, ...partial } = info;
    const error = await failure(
      readAppInfo({ timeoutMs: 1_000, source: { getAppInfo: async () => partial } }),
    );
    expect(error.kind).toBe("decode");
    expect(error.message).toContain("buildNumber");
  });

  test("times out when the native side never answers", async () => {
    jest.useFakeTimers();
    try {
      const pending = failure(
        readAppInfo({ timeoutMs: 250, source: { getAppInfo: () => new Promise(() => {}) } }),
      );
      jest.advanceTimersByTime(250);
      expect((await pending).kind).toBe("timeout");
    } finally {
      jest.useRealTimers();
    }
  });
});
