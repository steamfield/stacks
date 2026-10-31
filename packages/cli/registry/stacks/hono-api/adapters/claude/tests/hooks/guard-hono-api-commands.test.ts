import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

const run = (command: string, background = false) =>
  runHook(
    "PreToolUse",
    "guard-hono-api-commands",
    background
      ? { ...bash(command), tool_input: { command, run_in_background: true } }
      : bash(command),
  );

const NODE = "The server and Vitest run on Node in this project.";
const BUN_TEST = "bun test is Bun's own test runner";
const BUN_SERVER = "That runs the server under Bun";
const FOREGROUND = "bun run dev never exits";

describe.concurrent("guard-hono-api-commands denies", () => {
  it.each([
    ["bun test", BUN_TEST],
    ["bun test src/config.test.ts", BUN_TEST],
    ["cd src && bun test", BUN_TEST],
    ['bash -c "bun test"', BUN_TEST],
    ["bun --bun test", BUN_TEST],
    ["bunx --bun vitest", NODE],
    ["bun --bun vitest run", NODE],
    ["bun run --bun dev", NODE],
    ["bun --bun run start", NODE],
    ["bun -b run test", NODE],
    ["bun src/main.ts", BUN_SERVER],
    ["bun run src/main.ts", BUN_SERVER],
    ["bun --watch ./src/main.ts", BUN_SERVER],
    ["bun run dev", FOREGROUND],
    ["bun dev", FOREGROUND],
    ["npm run dev", FOREGROUND],
  ])("%j", async (command, reason) => {
    expect(denyReason(await run(command))).toContain(reason);
  });
});

describe.concurrent("guard-hono-api-commands allows", () => {
  it.each([
    "bun run test",
    'bun run test tests/http-contract.test.ts -t "creates"',
    "bunx vitest run",
    "bun run build",
    "bun run start",
    "PORT_API=8123 bun run start",
    "node src/main.ts",
    "bun scripts/prepare.ts",
    "bun --bun scripts/tool.ts",
    "bun add hono @hono/zod-openapi",
    "git commit -m 'bun test is banned here'",
    'bun run test tests/hooks -t "bun test"',
    "cat <<EOF\nbun run dev\nEOF",
  ])("%j", async (command) => {
    const result = await run(command);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("bun run dev in the background", async () => {
    const result = await run("bun run dev", true);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });
});
