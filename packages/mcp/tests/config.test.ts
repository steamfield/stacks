import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect } from "effect";
import { resolveConfig } from "../src/config";
import { ConfigInvalid } from "../src/errors";
import { fakeCli, tempDir } from "./helpers/cli";

function installedDependency(root: string) {
  const dir = join(root, "dependency with spaces");
  mkdirSync(join(dir, "bin"), { recursive: true });
  const packageJson = join(dir, "package.json");
  writeFileSync(
    packageJson,
    JSON.stringify({ name: "@steamfield/stacks", bin: { stacks: "bin/cli-entry.mjs" } }),
  );
  const entry = join(dir, "bin/cli-entry.mjs");
  writeFileSync(entry, "", { mode: 0o755 });
  return { dir: realpathSync(dir), packageJson, entry: realpathSync(entry) };
}

describe("CLI configuration", () => {
  it.effect(
    "an explicit entry wins over the dependency and preserves only defined environment entries",
    () =>
      Effect.gen(function* () {
        const root = tempDir();
        const entry = fakeCli(root, "");
        const dependency = installedDependency(tempDir());
        const env = { STACKS_MCP_CLI: entry, PATH: root, CUSTOM: "héllo", ABSENT: undefined };
        const config = yield* resolveConfig({
          env,
          execPath: process.execPath,
          dependency: { packageJson: dependency.packageJson },
        }).pipe(Effect.provide(NodeServices.layer));
        expect(config.cliEntry).toBe(entry);
        expect(config.node).toBe(process.execPath);
        expect(config.env).toEqual({ STACKS_MCP_CLI: entry, PATH: root, CUSTOM: "héllo" });
        expect(Duration.toSeconds(config.timeout)).toBe(900);
        expect(config.logLevel).toBe("Info");
      }),
  );

  it.effect(
    "a symlinked dependency resolves its declared bin to a real path and accepts lowercase debug",
    () =>
      Effect.gen(function* () {
        const dependency = installedDependency(tempDir());
        const link = join(tempDir(), "linked package");
        symlinkSync(dependency.dir, link);
        const config = yield* resolveConfig({
          env: {
            PATH: "",
            STACKS_MCP_LOG_LEVEL: "debug",
            STACKS_MCP_TIMEOUT_SECONDS: "7",
          },
          execPath: process.execPath,
          dependency: { packageJson: join(link, "package.json") },
        }).pipe(Effect.provide(NodeServices.layer));
        expect(config.cliEntry).toBe(dependency.entry);
        expect(config.logLevel).toBe("Debug");
        expect(Duration.toSeconds(config.timeout)).toBe(7);
      }),
  );

  it.effect.each(["wrong name", "missing bin.stacks"])(
    "a dependency with %s fails as ConfigInvalid",
    (invalid) =>
      Effect.gen(function* () {
        const dependency = installedDependency(tempDir());
        const metadata =
          invalid === "wrong name"
            ? { name: "another-package", bin: { stacks: "bin/cli-entry.mjs" } }
            : { name: "@steamfield/stacks", bin: {} };
        writeFileSync(dependency.packageJson, JSON.stringify(metadata));
        const error = yield* Effect.flip(
          resolveConfig({
            env: { PATH: "" },
            execPath: process.execPath,
            dependency: { packageJson: dependency.packageJson },
          }),
        ).pipe(Effect.provide(NodeServices.layer));
        expect(error).toBeInstanceOf(ConfigInvalid);
        expect(error.message).toContain("STACKS_MCP_CLI");
        expect(error.message).toContain("@steamfield/stacks");
      }),
  );

  it.effect.each([
    { STACKS_MCP_TIMEOUT_SECONDS: "0" },
    { STACKS_MCP_TIMEOUT_SECONDS: "-1" },
    { STACKS_MCP_TIMEOUT_SECONDS: "1.5" },
    { STACKS_MCP_TIMEOUT_SECONDS: "ten" },
    { STACKS_MCP_LOG_LEVEL: "verbose" },
  ])("invalid configuration %j fails as ConfigInvalid", (bad) =>
    Effect.gen(function* () {
      const entry = fakeCli(tempDir(), "");
      const error = yield* Effect.flip(
        resolveConfig({
          env: { STACKS_MCP_CLI: entry, ...bad },
          execPath: process.execPath,
          dependency: undefined,
        }),
      ).pipe(Effect.provide(NodeServices.layer));
      expect(error).toBeInstanceOf(ConfigInvalid);
    }),
  );

  it.effect.each(["missing", "relative"])(
    "a %s explicit entry fails even when the dependency is valid",
    (invalid) =>
      Effect.gen(function* () {
        const root = tempDir();
        const dependency = installedDependency(root);
        const error = yield* Effect.flip(
          resolveConfig({
            env: {
              STACKS_MCP_CLI: invalid === "missing" ? join(root, "missing") : "relative/stacks",
              PATH: "",
            },
            execPath: process.execPath,
            dependency: { packageJson: dependency.packageJson },
          }),
        ).pipe(Effect.provide(NodeServices.layer));
        expect(error).toBeInstanceOf(ConfigInvalid);
        expect(error.message).toContain("STACKS_MCP_CLI");
      }),
  );

  it.effect("no dependency and no explicit entry names both ways to configure the CLI", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveConfig({ env: { PATH: "" }, execPath: process.execPath, dependency: undefined }),
      ).pipe(Effect.provide(NodeServices.layer));
      expect(error).toBeInstanceOf(ConfigInvalid);
      expect(error.message).toContain("STACKS_MCP_CLI");
      expect(error.message).toContain("@steamfield/stacks");
    }),
  );

  it.effect("a valid stacks command on PATH is ignored when the dependency is missing", () =>
    Effect.gen(function* () {
      const root = tempDir();
      const dependency = installedDependency(root);
      symlinkSync(dependency.entry, join(root, "stacks"));
      const error = yield* Effect.flip(
        resolveConfig({ env: { PATH: root }, execPath: process.execPath, dependency: undefined }),
      ).pipe(Effect.provide(NodeServices.layer));
      expect(error).toBeInstanceOf(ConfigInvalid);
      expect(error.message).toContain("STACKS_MCP_CLI");
      expect(error.message).toContain("@steamfield/stacks");
    }),
  );
});
