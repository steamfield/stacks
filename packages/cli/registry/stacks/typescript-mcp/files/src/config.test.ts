import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { tempRoot } from "../tests/helpers/server.ts";
import { ConfigError, loadConfig } from "./config.ts";

let root: string;
let cleanup: () => void;
beforeEach(() => {
  ({ root, cleanup } = tempRoot());
});
afterEach(() => cleanup());

test("defaults everything but the root", async () => {
  expect(await loadConfig({ MCP_ROOT: root }, "/")).toEqual({
    root,
    logLevel: "info",
    maxFileBytes: 1_048_576,
  });
});

test("reads every setting, resolving a relative root against cwd", async () => {
  const config = await loadConfig(
    { MCP_ROOT: ".", LOG_LEVEL: "DEBUG", MAX_FILE_BYTES: "10" },
    root,
  );
  expect(config).toEqual({ root, logLevel: "debug", maxFileBytes: 10 });
});

test("an empty value means the default", async () => {
  const config = await loadConfig({ MCP_ROOT: root, LOG_LEVEL: "", MAX_FILE_BYTES: "" }, "/");
  expect(config.logLevel).toBe("info");
  expect(config.maxFileBytes).toBe(1_048_576);
});

test.each([
  ["no root", () => ({}), "MCP_ROOT"],
  ["an empty root", () => ({ MCP_ROOT: "" }), "MCP_ROOT"],
  ["an unknown level", () => ({ MCP_ROOT: root, LOG_LEVEL: "loud" }), "LOG_LEVEL"],
  ["a zero limit", () => ({ MCP_ROOT: root, MAX_FILE_BYTES: "0" }), "MAX_FILE_BYTES"],
  ["a fractional limit", () => ({ MCP_ROOT: root, MAX_FILE_BYTES: "1.5" }), "MAX_FILE_BYTES"],
])("%s is a ConfigError naming the variable", async (_name, env, variable) => {
  const error = await loadConfig(env(), "/").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ConfigError);
  expect((error as Error).message).toContain(variable);
});

test.each([
  ["a missing directory", () => join(root, "missing")],
  [
    "a file",
    () => {
      writeFileSync(join(root, "file.txt"), "x");
      return join(root, "file.txt");
    },
  ],
])("a root that is %s is a ConfigError", async (_name, path) => {
  await expect(loadConfig({ MCP_ROOT: path() }, "/")).rejects.toThrow(
    "MCP_ROOT is not a directory",
  );
});
