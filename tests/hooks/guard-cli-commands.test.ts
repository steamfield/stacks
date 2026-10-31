import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

const check = (command: string) => runHook("PreToolUse", "guard-cli-commands", bash(command));
describe("base CLI runner guard", () => {
  it.each([
    "bun test",
    "bun test --coverage",
    "bun test ./tests/config.test.ts",
    "bun test -t ./e2e",
    "bun test ./packages/cli/tests",
    "bun test ./packages/api/src",
    "bun test ./packages/../e2e",
    "bun --bun run test:unit",
    "bun --bun node_modules/.bin/vitest run",
    "bun add @effect/schema",
    "bun a @effect/schema",
    "bun add zod",
    "cd packages/cli && bun add zod",
    'cd "$SCAFFOLD" && bun add zod',
    "bun add --cwd packages/cli zod",
  ])("denies %s", async (command) => expect(denyReason(await check(command))).toBeDefined());
  it.each([
    "bun run test",
    "bun test ./e2e",
    "bun test ./e2e -t 'unit tests'",
    "bun test ./packages/cli/e2e",
    "bun test ./packages/cli/e2e/binary.test.ts",
    "bun test ./packages/api/e2e",
    "git commit -m 'bun test'",
    "bun add effect",
    // A project scaffolded outside this repository picks its own schema library.
    "cd /tmp/scaffold && bun add zod",
    "bun add --cwd /tmp/scaffold zod",
    "bun add --cwd=/tmp/scaffold zod",
  ])("allows %s", async (command) => expect(denyReason(await check(command))).toBeUndefined());

  it("allows bun add zod when the session's directory is outside the repository", async () => {
    const result = await runHook("PreToolUse", "guard-cli-commands", {
      ...bash("bun add zod"),
      cwd: "/tmp/scaffold",
    });
    expect(denyReason(result)).toBeUndefined();
  });
});
