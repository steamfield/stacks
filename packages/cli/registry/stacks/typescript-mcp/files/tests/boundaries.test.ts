// Probes biome-plugins/boundaries.grit on real files: each rule must fire where it should and stay
// quiet in the one place the thing is allowed.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The plugin's messages for `source` written at `path` (relative to a src/-shaped fixture). */
function pluginMessages(path: string, source: string): string[] {
  const dir = mkdtempSync(join(ROOT, ".boundary-fixture-"));
  fixtures.push(dir);
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const biome = join(ROOT, "node_modules/.bin/biome");
  const result = spawnSync(biome, ["lint", "--reporter=json", file], { encoding: "utf8" });
  if (!result.stdout) throw new Error(result.stderr);
  const report = JSON.parse(result.stdout) as {
    diagnostics?: { category?: string; message?: string }[];
  };
  return (report.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === "plugin")
    .map((diagnostic) => diagnostic.message ?? "");
}

test.each([
  ["src/server.ts", 'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";', "v1"],
  ["tests/x.test.ts", 'import { Client } from "@modelcontextprotocol/sdk/client";', "v1"],
  ["src/server.ts", 'import { serveStdio } from "@modelcontextprotocol/server/stdio";', "index.ts"],
  ["src/tools/x.ts", 'import { createServer } from "@modelcontextprotocol/node";', "index.ts"],
  ["src/tools/x.ts", 'console.log("debug");', "stdout"],
  ["src/index.ts", 'console.error("ready");', "stdout"],
  ["src/index.ts", 'process.stdout.write("ready\\n");', "JSON-RPC"],
  ["src/config.ts", "export const root = process.env.MCP_ROOT;", "src/index.ts"],
])("%s: %s is rejected", (path, source, pointer) => {
  const messages = pluginMessages(path, source);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(pointer);
});

test.each([
  ["src/index.ts", 'import { serveStdio } from "@modelcontextprotocol/server/stdio";'],
  ["src/index.ts", "export const env = process.env;"],
  ["src/index.ts", 'process.stderr.write("bad config\\n");'],
  ["src/server.ts", 'import { McpServer } from "@modelcontextprotocol/server";'],
  ["tests/x.test.ts", 'import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";'],
  ["scripts/x.ts", 'console.log("outside src");'],
])("%s: %s is allowed", (path, source) => {
  expect(pluginMessages(path, source)).toEqual([]);
});
