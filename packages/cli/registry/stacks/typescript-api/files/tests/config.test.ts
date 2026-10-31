import { ConfigProvider, Context, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/config.ts";

const read = (env: Record<string, string | undefined>) =>
  Effect.runPromiseExit(
    Effect.scoped(
      Layer.build(AppConfig.layer).pipe(
        Effect.map((context) => Context.get(context, AppConfig)),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
      ),
    ),
  );

describe("startup configuration", () => {
  it("uses defaults and treats blank values as unset", async () => {
    const result = await read({ PORT_API: "", PORT: "", LOG_LEVEL: "", LOG_FILE: "" });
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result))
      expect(result.value).toMatchObject({
        port: 3000,
        logLevel: "info",
        production: false,
        logFile: "logs/server.jsonl",
      });
  });
  it("prefers PORT_API and accepts case-insensitive levels", async () => {
    const result = await read({
      PORT_API: "8765",
      PORT: "invalid",
      LOG_LEVEL: "DeBuG",
      NODE_ENV: "production",
      NO_COLOR: "1",
      LOG_FILE: "custom.jsonl",
    });
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result))
      expect(result.value).toEqual({
        port: 8765,
        logLevel: "debug",
        production: true,
        noColor: true,
        logFile: "custom.jsonl",
        maxBodyBytes: 65536,
      });
  });
  it("falls back to PORT when PORT_API is absent", async () => {
    const result = await read({ PORT: "9876" });
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) expect(result.value.port).toBe(9876);
  });
  it.each([
    { PORT_API: "invalid" },
    { PORT_API: "70000" },
    { PORT: "-1" },
    { LOG_LEVEL: "loud" },
    { MAX_BODY_BYTES: "0" },
    { MAX_BODY_BYTES: "invalid" },
  ])("rejects invalid settings %j", async (env) => {
    expect(Exit.isFailure(await read(env))).toBe(true);
  });
});
