import { ConfigProvider, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { AppConfig } from "./config";
import { makeRuntime } from "./runtime";
import { Health } from "./services/health";

it("defaults empty config and accepts case-insensitive log levels", async () => {
  const runtime = makeRuntime(
    ConfigProvider.fromEnvRecord({ GREETING: "", LOG_LEVEL: "DeBuG", LOG_FILE: "" }),
    () => {},
  );
  try {
    expect(await runtime.runPromise(AppConfig)).toMatchObject({
      greeting: "Hello",
      maxBodyBytes: 4096,
      logLevel: "debug",
      logFile: "logs/server.jsonl",
    });
  } finally {
    await runtime.dispose();
  }
});

it.each([{ GREETING: "   " }, { LOG_LEVEL: "loud" }, { MAX_BODY_BYTES: "0" }])(
  "rejects invalid config %j",
  async (env) => {
    const runtime = makeRuntime(ConfigProvider.fromEnvRecord(env), () => {});
    try {
      expect(Exit.isFailure(await runtime.runPromiseExit(AppConfig))).toBe(true);
    } finally {
      await runtime.dispose();
    }
  },
);

it("builds isolated config/service layers and refuses work after disposal", async () => {
  const first = makeRuntime(ConfigProvider.fromEnvRecord({ GREETING: "First" }), () => {});
  const second = makeRuntime(ConfigProvider.fromEnvRecord({ GREETING: "Second" }), () => {});
  const read = Effect.gen(function* () {
    return yield* (yield* Health).greeting();
  });
  try {
    expect(await first.runPromise(read)).toEqual({ message: "First, world!" });
    expect(await second.runPromise(read)).toEqual({ message: "Second, world!" });
    await first.dispose();
    expect(Exit.isFailure(await first.runPromiseExit(read))).toBe(true);
    expect(await second.runPromise(read)).toEqual({ message: "Second, world!" });
  } finally {
    await first.dispose();
    await second.dispose();
  }
});
