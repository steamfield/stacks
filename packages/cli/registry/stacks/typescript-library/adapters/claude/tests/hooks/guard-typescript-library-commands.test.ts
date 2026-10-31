import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

const run = (command: string) =>
  runHook("PreToolUse", "guard-typescript-library-commands", bash(command));

const RELEASE = "the maintainer's step";
const BUN_TEST = "bun test is Bun's own test runner";
const NODE = "run on Node in this project";

describe.concurrent("guard-typescript-library-commands denies", () => {
  it.each([
    ["npm publish", RELEASE],
    ["npm publish --dry-run", RELEASE],
    ["npm --workspace lib publish", RELEASE],
    ["cd dist && npm publish", RELEASE],
    ["bun publish", RELEASE],
    ["pnpm publish --no-git-checks", RELEASE],
    ["yarn publish", RELEASE],
    ["yarn npm publish", RELEASE],
    ["npm unpublish my-lib --force", RELEASE],
    ["npm deprecate my-lib 'use the next major'", RELEASE],
    ["npm dist-tag add my-lib@next latest", RELEASE],
    ["npm version patch", RELEASE],
    ["bun pm version minor", RELEASE],
    ["bunx changeset publish", RELEASE],
    ["bun x changeset publish", RELEASE],
    ['bash -c "npm publish"', RELEASE],
    ["bun test", BUN_TEST],
    ["bun test src/slugify.test.ts", BUN_TEST],
    ["bunx --bun vitest", NODE],
    ["bun --bun run test", NODE],
    ["bun -b run build", NODE],
  ])("%j", async (command, reason) => {
    expect(denyReason(await run(command))).toContain(reason);
  });
});

describe.concurrent("guard-typescript-library-commands allows", () => {
  it.each([
    "bun run test",
    'bun run test src/slugify.test.ts -t "slugify"',
    "bunx vitest run",
    "bun run build",
    "bun run lint:package",
    "bun run test:consumer",
    "bun pm pack --dry-run",
    "npm pack --dry-run",
    "npm view tsdown version",
    "bunx changeset",
    "bunx changeset version",
    "bun add -d tsdown publint",
    "bun --bun scripts/consumer.ts",
    "git commit -m 'npm publish is the maintainer step'",
    'bun run test -t "npm publish"',
    "cat <<EOF\nnpm publish\nEOF",
  ])("%j", async (command) => {
    const result = await run(command);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });
});
