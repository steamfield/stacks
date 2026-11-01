import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

const run = (command: string, background = false) =>
  runHook("PreToolUse", "guard-nuxt-commands", {
    ...bash(command),
    ...(background ? { tool_input: { command, run_in_background: true } } : {}),
  });

const NODE = "run on Node in this project.";
const BUN_TEST = "bun test is bun's own test runner";
const SERVER = "A server never exits";
const GENERATOR = "The Nuxt project already exists.";

describe.concurrent("guard-nuxt-commands denies", () => {
  it.each([
    ["bun test", BUN_TEST],
    ["bun test server/utils/notes.test.ts", BUN_TEST],
    ['bash -c "bun test"', BUN_TEST],
    ["bunx --bun vitest", NODE],
    ["bunx --bun nuxt build", NODE],
    ["bun --bun run build", NODE],
    ["bun run --bun e2e", NODE],
    ["bunx --bun playwright test", NODE],
    ["bun run dev", SERVER],
    ["bun run start", SERVER],
    ["bunx nuxt dev", SERVER],
    ["nuxt dev --port 3001", SERVER],
    ["bunx nuxi preview", SERVER],
    ["PORT=3001 node .output/server/index.mjs", SERVER],
    ["bunx nuxi@latest init .", GENERATOR],
    ["npm create nuxt@latest my-app", GENERATOR],
    ["bun create nuxt", GENERATOR],
    ["bunx create-nuxt my-app", GENERATOR],
  ])("%j", async (command, reason) => {
    expect(denyReason(await run(command))).toContain(reason);
  });
});

describe.concurrent("guard-nuxt-commands allows", () => {
  it.each([
    "bun run test",
    'bun run test server/utils/notes.test.ts -t "adds"',
    "bun run lint",
    "bun run build",
    "bun run e2e",
    "bunx nuxt prepare",
    "bunx nuxt typecheck",
    "bunx vitest run --project unit",
    "bunx playwright test",
    "bun --bun scripts/tool.ts",
    "git commit -m 'bun test and nuxt dev are banned here'",
    'bun run test tests/hooks -t "bun run dev"',
    "cat <<EOF\nbun test\nEOF",
  ])("%j", async (command) => {
    const result = await run(command);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it.each(["bun run dev", "bun run start", "bunx nuxt dev"])(
    "%j in the background",
    async (command) => {
      const result = await run(command, true);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
    },
  );
});
