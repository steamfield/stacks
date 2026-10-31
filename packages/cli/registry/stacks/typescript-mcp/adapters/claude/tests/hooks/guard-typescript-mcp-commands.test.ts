import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

const run = (command: string, background = false) =>
  runHook(
    "PreToolUse",
    "guard-typescript-mcp-commands",
    background
      ? { ...bash(command), tool_input: { command, run_in_background: true } }
      : bash(command),
  );

const V1 = "@modelcontextprotocol/sdk is the v1 SDK";
const NODE = "The server and Vitest run on Node in this project.";
const BUN_TEST = "bun test is Bun's own test runner";
const BUN_SERVER = "That runs the server under Bun";
const INSPECTOR = "MCP Inspector's web UI never exits";

describe.concurrent("guard-typescript-mcp-commands denies", () => {
  it.each([
    ["bun add @modelcontextprotocol/sdk", V1],
    ["bun add @modelcontextprotocol/sdk@latest zod", V1],
    ["npm install @modelcontextprotocol/sdk", V1],
    ["pnpm add @modelcontextprotocol/sdk", V1],
    ["cd sub && yarn add @modelcontextprotocol/sdk", V1],
    ["bun test", BUN_TEST],
    ["bun test src/config.test.ts", BUN_TEST],
    ['bash -c "bun test"', BUN_TEST],
    ["bunx --bun vitest", NODE],
    ["bun --bun run test", NODE],
    ["bun -b run smoke", NODE],
    ["bun src/index.ts", BUN_SERVER],
    ["bun run ./src/index.ts", BUN_SERVER],
    ["bun run inspect", INSPECTOR],
    ["npm run inspect", INSPECTOR],
    ["bunx @modelcontextprotocol/inspector node dist/index.js", INSPECTOR],
    ["npx @modelcontextprotocol/inspector@latest node dist/index.js", INSPECTOR],
    ["node_modules/.bin/mcp-inspector node dist/index.js", INSPECTOR],
  ])("%j", async (command, reason) => {
    expect(denyReason(await run(command))).toContain(reason);
  });
});

describe.concurrent("guard-typescript-mcp-commands allows", () => {
  it.each([
    "bun add @modelcontextprotocol/server zod",
    "bun add -d @modelcontextprotocol/client @modelcontextprotocol/inspector",
    "bun run test",
    'bun run test tests/server.test.ts -t "read_file"',
    "bunx vitest run",
    "bun run build",
    "bun run smoke",
    "bunx mcp-inspector --cli -e MCP_ROOT=. node dist/index.js --method tools/list",
    "node_modules/.bin/mcp-inspector --cli node dist/index.js --method tools/list",
    "node --env-file-if-exists=.env dist/index.js",
    "bun scripts/smoke.ts",
    "bun --bun scripts/tool.ts",
    "git commit -m 'never bun add @modelcontextprotocol/sdk'",
    'bun run test tests/hooks -t "bun test"',
    "cat <<EOF\nbun run inspect\nEOF",
  ])("%j", async (command) => {
    const result = await run(command);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("bun run inspect in the background", async () => {
    const result = await run("bun run inspect", true);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });
});
