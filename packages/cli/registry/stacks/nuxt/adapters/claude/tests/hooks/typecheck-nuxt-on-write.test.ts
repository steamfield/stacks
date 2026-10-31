import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { type Fixture, makeFixture, runHook } from "../helpers/hooks";

// A solution-style tsconfig like the shipped one: plain tsc checks nothing through it, vue-tsc -b
// follows the reference.
let project: Fixture;
beforeEach(() => {
  project = makeFixture();
  mkdirSync(join(project.dir, "server"));
  mkdirSync(join(project.dir, ".nuxt"));
  writeFileSync(join(project.dir, ".nuxt/tsconfig.app.json"), "{}\n");
  writeFileSync(join(project.dir, "server/ok.ts"), "export const ok = 1;\n");
  writeFileSync(
    join(project.dir, "tsconfig.json"),
    JSON.stringify({ files: [], references: [{ path: "./tsconfig.server.json" }] }),
  );
  writeFileSync(
    join(project.dir, "tsconfig.server.json"),
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
      include: ["server/**/*.ts"],
    }),
  );
});
afterEach(() => project.cleanup());

const feedback = (path: string) =>
  runHook(
    "PostToolUse",
    "typecheck-nuxt-on-write",
    { tool_name: "Edit", tool_input: { file_path: path } },
    { env: { CLAUDE_PROJECT_DIR: project.dir } },
  );

it("reports errors through the project references, and stays quiet once fixed", async () => {
  const path = join(project.dir, "server/count.ts");
  writeFileSync(path, "export const count: number = 'wrong';\n");
  const broken = await feedback(path);
  const context = broken.output?.hookSpecificOutput?.additionalContext ?? "";
  expect(context).toMatch(/^vue-tsc found 1 type error\(s\), 1 in server\/count\.ts:/);
  expect(context).toContain("server/count.ts(1,14): error TS2322");
  writeFileSync(path, "export const count: number = 1;\n");
  expect((await feedback(path)).stdout).toBe("");
}, 60_000);

it("ignores files it doesn't check", async () => {
  writeFileSync(join(project.dir, "server/count.ts"), "export const count: number = 'wrong';\n");
  writeFileSync(join(project.dir, "notes.md"), "# notes\n");
  expect((await feedback(join(project.dir, "notes.md"))).stdout).toBe("");
});
