#!/usr/bin/env bun
// `smoke`: starts the built dist/index.js the way a host does, through MCP Inspector's CLI (a
// client this project doesn't write), and checks tools/list. --strict makes Inspector fail on a
// tool schema other clients can't use. Run `bun run build` first.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
process.chdir(root);

if (!existsSync("dist/index.js")) {
  console.error("smoke: dist/index.js is missing; run bun run build first");
  process.exit(1);
}

const inspector = spawnSync(
  "node_modules/.bin/mcp-inspector",
  [
    "--cli",
    "-e",
    `MCP_ROOT=${root}`,
    "-e",
    "LOG_LEVEL=warn",
    "node",
    "dist/index.js",
    "--method",
    "tools/list",
    "--strict",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 60_000 },
);
if (inspector.status !== 0) {
  console.error(`smoke: inspector exited ${inspector.status ?? inspector.signal}`);
  console.error(inspector.stdout);
  process.exit(1);
}

type Tool = { name?: unknown; description?: unknown; inputSchema?: { type?: unknown } };
const { tools } = JSON.parse(inspector.stdout) as { tools?: Tool[] };
const problems: string[] = [];
if (!tools?.length) problems.push("tools/list returned no tools");
for (const tool of tools ?? []) {
  const name = String(tool.name);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) problems.push(`${name}: name is not snake_case`);
  if (typeof tool.description !== "string" || tool.description.length < 20) {
    problems.push(`${name}: description is missing or too short to tell a model when to call it`);
  }
  if (tool.inputSchema?.type !== "object") problems.push(`${name}: inputSchema is not an object`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`smoke: ${problem}`);
  process.exit(1);
}
console.log(`smoke: ${tools?.length} tool(s): ${tools?.map((tool) => tool.name).join(", ")}`);
