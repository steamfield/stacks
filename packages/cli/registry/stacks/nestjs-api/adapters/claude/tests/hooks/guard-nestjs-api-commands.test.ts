import { describe, expect, it } from "vitest";
import { bash, denyReason, runHook } from "../helpers/hooks";

const run = (command: string, background = false) =>
  runHook(
    "PreToolUse",
    "guard-nestjs-api-commands",
    background
      ? { ...bash(command), tool_input: { command, run_in_background: true } }
      : bash(command),
  );

const NODE = "The server and Vitest run on Node in this project.";
const BUN_TEST = "bun test is Bun's own test runner";
const SOURCE = "Nest needs decorator metadata";
const JEST = "The tests here are Vitest";
const TYPESCRIPT = "Adding typescript without a version";
const NEW = "This project already exists.";
const FOREGROUND = "nest start --watch never exits";

describe.concurrent("guard-nestjs-api-commands denies", () => {
  it.each([
    ["bun test", BUN_TEST],
    ["bun test src/notes/notes.service.spec.ts", BUN_TEST],
    ["cd src && bun test", BUN_TEST],
    ["bunx --bun vitest run", NODE],
    ["bun --bun run start", NODE],
    ["bunx --bun nest build", NODE],
    ["bun src/main.ts", SOURCE],
    ["bun run src/main.ts", SOURCE],
    ["node src/main.ts", SOURCE],
    ["node --experimental-strip-types ./src/main.ts", SOURCE],
    ["bunx tsx src/main.ts", SOURCE],
    ["tsx watch src/main.ts", SOURCE],
    ["bun add -d jest ts-jest @types/jest", JEST],
    ["npm i -D ts-node", JEST],
    ["bun add -d typescript", TYPESCRIPT],
    ["bun add -D typescript@latest", TYPESCRIPT],
    ["npm install --save-dev typescript", TYPESCRIPT],
    ["bunx nest new api", NEW],
    ["bunx @nestjs/cli new .", NEW],
    ["nest new api", NEW],
    ["bun run dev", FOREGROUND],
    ["bun dev", FOREGROUND],
    ["bunx nest start --watch", FOREGROUND],
    ["nest start -w", FOREGROUND],
  ])("%j", async (command, reason) => {
    expect(denyReason(await run(command))).toContain(reason);
  });
});

describe.concurrent("guard-nestjs-api-commands allows", () => {
  it.each([
    "bun run test",
    'bun run test:e2e -t "creates a note"',
    "bunx vitest run src/config/env.spec.ts",
    "bun run build",
    "bun run start",
    "PORT_API=8123 bun run start",
    "node dist/main.js",
    "bunx nest build",
    "bunx nest g module widgets",
    "bunx nest g service widgets --no-spec",
    "bunx nest info",
    "bun add -d typescript@6",
    "bun add @nestjs/common @nestjs/core",
    "bun add -d vitest supertest",
    "bun scripts/prepare.ts",
    "git commit -m 'bun test is banned here'",
    'bun run test tests/hooks -t "bun add -d jest"',
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

  it("names the TypeScript range the installed Nest CLI declares", async () => {
    // The real CLI's range when it's installed (the scaffold), a pointer to its manifest otherwise.
    const reason = denyReason(await run("bun add -d typescript"));
    expect(reason).toMatch(/declares typescript \S+|node_modules\/@nestjs\/cli\/package\.json/);
  });
});
