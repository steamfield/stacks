import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { type Fixture, makeFixture, runHook } from "../helpers/hooks";

let project: Fixture;
beforeEach(() => {
  project = makeFixture();
  mkdirSync(join(project.dir, "src"));
  mkdirSync(join(project.dir, "scripts"));
  writeFileSync(join(project.dir, "src/app.ts"), "export const app = 1;\n");
  writeFileSync(
    join(project.dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        types: [],
        lib: ["ES2023"],
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "bundler",
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
      exclude: ["scripts"],
    }),
  );
  writeFileSync(
    join(project.dir, "tsconfig.tools.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      include: ["scripts/**/*.ts"],
      exclude: [],
    }),
  );
});
afterEach(() => project.cleanup());

const feedback = (script: string, path: string) =>
  runHook(
    "PostToolUse",
    script,
    { tool_name: "Edit", tool_input: { file_path: path } },
    { env: { CLAUDE_PROJECT_DIR: project.dir } },
  );

it("reports errors excluded from app checking, and stays quiet after they are fixed", async () => {
  const path = join(project.dir, "scripts/check.ts");
  writeFileSync(path, "export const count: number = 'wrong';\n");
  expect((await feedback("typecheck-on-write", path)).stdout).toBe("");
  const broken = await feedback("typecheck-tools-on-write", path);
  expect(broken.output?.hookSpecificOutput?.additionalContext).toContain(
    "scripts/check.ts(1,14): error TS2322",
  );
  writeFileSync(path, "export const count: number = 1;\n");
  expect((await feedback("typecheck-tools-on-write", path)).stdout).toBe("");
});

it("leaves app writes to the shared app checker", async () => {
  writeFileSync(join(project.dir, "scripts/check.ts"), "export const count: number = 'wrong';\n");
  expect((await feedback("typecheck-tools-on-write", join(project.dir, "src/app.ts"))).stdout).toBe(
    "",
  );
});
