import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

const run = (command: string) => runHook("PreToolUse", "guard-react-vite-commands", bash(command));

const NODE = "Vite, Vitest and Playwright run on Node in this project.";
const BUN_TEST = "bun test is Bun's own test runner";
const DOM = "react-router-dom was folded into react-router.";
const FRAMEWORK = "@react-router/dev is React Router's framework mode";

describe.concurrent("guard-react-vite-commands denies", () => {
  it.each([
    ["bun test", BUN_TEST],
    ["bun test src/api/client.test.ts", BUN_TEST],
    ["cd src && bun test", BUN_TEST],
    ['bash -c "bun test"', BUN_TEST],
    ["bunx --bun vitest", NODE],
    ["bun --bun vite build", NODE],
    ["bunx --bun playwright test", NODE],
    ["bun run --bun dev", NODE],
    ["bun --bun run e2e", NODE],
    ["bun add react-router-dom", DOM],
    ["bun add react-router-dom@latest", DOM],
    ["npm install react-router-dom", DOM],
    ["bun add -d @react-router/dev", FRAMEWORK],
    ["pnpm add @react-router/dev@latest", FRAMEWORK],
  ])("%j", async (command, reason) => {
    expect(denyReason(await run(command))).toContain(reason);
  });
});

describe.concurrent("guard-react-vite-commands allows", () => {
  it.each([
    "bun run test",
    'bun run test src/app/routes.test.tsx -t "deep link"',
    "bun add react-router",
    "bun add @tanstack/react-query",
    "bunx vitest run",
    "bunx playwright install chromium",
    "bun --bun scripts/tool.ts",
    "git commit -m 'bun test is banned here'",
    'bun run test tests/boundaries.test.ts -t "bun test"',
    "cat <<EOF\nbun add react-router-dom\nEOF",
  ])("%j", async (command) => {
    const result = await run(command);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });
});
