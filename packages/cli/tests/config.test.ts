import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { AppConfig } from "../src/config";
import { tempDir } from "./helpers/cli";

test("configuration is lazy and caches within each layer, but not across invocations", async () => {
  const dir = tempDir();
  const configDir = join(dir.path, "stacks");
  mkdirSync(configDir, { recursive: true });
  const file = join(configDir, "config.json");
  writeFileSync(file, '{"dataDir":"/first"}');
  const layer = AppConfig.memory({ HOME: dir.path, XDG_CONFIG_HOME: dir.path });
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* AppConfig;
        const first = yield* config.settings;
        yield* Effect.sync(() => writeFileSync(file, '{"dataDir":"/second"}'));
        const second = yield* config.settings;
        return [first, second];
      }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)),
    );
    expect(result).toEqual([{ dataDir: "/first" }, { dataDir: "/first" }]);
    const fresh = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* AppConfig).settings;
      }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)),
    );
    expect(fresh).toEqual({ dataDir: "/second" });
  } finally {
    dir.cleanup();
  }
});
test("building a config layer never opens a broken config file", async () => {
  const dir = tempDir();
  const path = join(dir.path, "stacks");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "config.json"), "not json");
  try {
    await expect(
      Effect.runPromise(
        AppConfig.pipe(
          Effect.asVoid,
          Effect.provide(AppConfig.memory({ XDG_CONFIG_HOME: dir.path })),
          Effect.provide(NodeServices.layer),
        ),
      ),
    ).resolves.toBeUndefined();
  } finally {
    dir.cleanup();
  }
});

test("a LOG_LEVEL that names an Object.prototype key falls back to warn", async () => {
  for (const raw of ["constructor", "__proto__", "toString"]) {
    const level = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* (yield* AppConfig).logging).level;
      }).pipe(
        Effect.provide(AppConfig.memory({ LOG_LEVEL: raw })),
        Effect.provide(NodeServices.layer),
      ),
    );
    expect(level).toBe("Warn");
  }
});
