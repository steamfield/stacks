import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

describe("shared package manager guard", () => {
  it.each(["npm install", "pnpm add a", "yarn", "npm ci"])("denies %s", async (command) => {
    expect(denyReason(await runHook("PreToolUse", "guard-commands", bash(command)))).toContain(
      "bun owns",
    );
  });
  it.each(["bun install", "npm view effect", "git commit -m 'npm install'", "echo 'pnpm add a'"])(
    "allows %s",
    async (command) => {
      expect(
        denyReason(await runHook("PreToolUse", "guard-commands", bash(command))),
      ).toBeUndefined();
    },
  );
});

/**
 * A clone's rr opt-in (`git config stacks.rr`), set through git's env config so it wins, with the
 * delegate marker under the name given (both cleared otherwise, so an inherited one can't leak in).
 */
const rrOptIn = (value: string, delegate?: "CODEX_DELEGATE" | "STACKS_DELEGATE") => ({
  env: {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "stacks.rr",
    GIT_CONFIG_VALUE_0: value,
    CODEX_DELEGATE: delegate === "CODEX_DELEGATE" ? "1" : undefined,
    STACKS_DELEGATE: delegate === "STACKS_DELEGATE" ? "1" : undefined,
  },
});

describe("whole test suites run through rr in a clone that opts in", () => {
  it.each([
    "bun run check",
    "bun run test",
    "bun run e2e",
    "bun run coverage",
    "bun run test:hooks",
    "cd packages/cli && bun run test:unit",
    "bun run --cwd packages/cli test:unit",
    "bun run --cwd packages/cli test:unit -- -t 'a name'",
    "bun run --filter '*' test",
    "bun run check 2>&1 | tail -40",
    "bash -c 'bun run check'",
    "bunx vitest run",
    "npx vitest",
    "cd packages/cli && bun test ./e2e",
    // An empty expansion or glob leaves no filter, which runs everything.
    "bunx vitest run $(ls tests/hooks/nope-*.test.ts 2>/dev/null)",
    "bunx vitest run tests/hooks/*.test.ts",
    "bun run --cwd packages/cli test:unit $FILES",
    "bunx vitest run --project cli",
    "bunx vitest run --maxWorkers 1",
  ])("denies %s", async (command) => {
    expect(
      denyReason(await runHook("PreToolUse", "guard-commands", bash(command), rrOptIn("true"))),
    ).toContain("rr check");
  });
  it.each([
    "rr check",
    "rr test-cli tests/cli.test.ts",
    "bun run lint",
    "bun run typecheck",
    "bun run build",
    "bun run --cwd packages/cli test:unit tests/cli.test.ts",
    "cd packages/cli && bun run test:unit tests/a.test.ts -t 'a name'",
    "bun run test:hooks tests/hooks/guard-commands.test.ts",
    "bunx vitest run tests/hooks/wiring.test.ts",
    "bunx vitest run 'tests/hooks/*.test.ts'",
    "bunx vitest run --project cli tests/cli.test.ts",
    "cd packages/cli && bun test ./e2e/budget.test.ts",
    "STACKS_LOCAL_GATE=1 bun run check",
    "git commit -m 'run bun run check before pushing'",
  ])("allows %s", async (command) => {
    expect(
      denyReason(await runHook("PreToolUse", "guard-commands", bash(command), rrOptIn("true"))),
    ).toBeUndefined();
  });
  it.each(["false", ""])("leaves whole suites local when stacks.rr is %j", async (value) => {
    for (const command of ["bun run check", "cd packages/cli && bun run test:unit"])
      expect(
        denyReason(await runHook("PreToolUse", "guard-commands", bash(command), rrOptIn(value))),
      ).toBeUndefined();
  });
});

describe("a delegate runs no full gate", () => {
  it.each([
    "rr check",
    "rr check 2>&1 | tail -1",
    "rr --host m4-mini check",
    "rr check-serial",
    "rr test",
    "rr test-cli",
    "rr test-hooks",
    "rr e2e",
    "bun run check",
    "STACKS_LOCAL_GATE=1 bun run check",
    "cd packages/cli && bun run test:unit",
    "rr test-cli $(ls tests/nope-*.test.ts)",
    "bunx vitest run $(ls tests/nope-*.test.ts)",
  ])("denies %s", async (command) => {
    expect(
      denyReason(
        await runHook(
          "PreToolUse",
          "guard-commands",
          bash(command),
          rrOptIn("true", "CODEX_DELEGATE"),
        ),
      ),
    ).toContain("Delegates run no full gate");
  });
  // A worktree on an older branch, or an older runner, still marks a delegate this way.
  it("denies the gate to a delegate marked with the older STACKS_DELEGATE", async () => {
    expect(
      denyReason(
        await runHook(
          "PreToolUse",
          "guard-commands",
          bash("rr check"),
          rrOptIn("true", "STACKS_DELEGATE"),
        ),
      ),
    ).toContain("Delegates run no full gate");
  });
  it.each([
    "rr test-cli tests/cli.test.ts",
    "rr test-cli -- -t 'a name'",
    "bun run --cwd packages/cli test:unit tests/cli.test.ts",
    "cd packages/format && bunx vitest run tests/stats.test.ts",
    "bun run lint",
    "bun run typecheck",
  ])("allows %s", async (command) => {
    expect(
      denyReason(
        await runHook(
          "PreToolUse",
          "guard-commands",
          bash(command),
          rrOptIn("true", "CODEX_DELEGATE"),
        ),
      ),
    ).toBeUndefined();
  });
});

describe("shell in-place edit guard", () => {
  it.each([
    "sed -i '' 's/a/b/' src/x.ts",
    "sed -i.bak -e 's/a/b/' x.md",
    "sed --in-place 's/a/b/' x.md",
    "perl -pi -e 's/a/b/' x.md",
    "python3 - <<'EOF'\nimport pathlib\npathlib.Path('x.md').write_text('y')\nEOF",
    "python3 - <<'EOF'\nopen('x.md', 'w').write('y')\nEOF",
  ])("denies %s", async (command) => {
    expect(denyReason(await runHook("PreToolUse", "guard-commands", bash(command)))).toContain(
      "Edit or Write tool",
    );
  });
  it.each([
    "sed -n '1,20p' x.md",
    "sed -E 's/a/b/' x.md > y.md",
    "perl -ne 'print if /a/' x.md",
    "python3 - <<'EOF'\nprint(open('x.md').read())\nEOF",
    "git commit -m 'use sed -i for the rename'",
  ])("allows %s", async (command) => {
    expect(
      denyReason(await runHook("PreToolUse", "guard-commands", bash(command))),
    ).toBeUndefined();
  });
});
