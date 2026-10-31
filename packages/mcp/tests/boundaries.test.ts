import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { tempDir } from "./helpers/temp";

const pkg = join(import.meta.dirname, "..");
const probes: ReadonlyArray<{
  readonly name: string;
  readonly source: string;
  readonly message: string;
  readonly allowed: string;
}> = [
  {
    name: "console call",
    source: 'console.log("x");',
    message: "never console",
    allowed: "tests/probe.ts",
  },
  {
    name: "console reference",
    source: "export const value = console.error;",
    message: "never console",
    allowed: "tests/probe.ts",
  },
  {
    name: "stdout",
    source: "export const value = process.stdout;",
    message: "Stdout belongs",
    allowed: "tests/probe.ts",
  },
  {
    name: "exit",
    source: "process.exit(0);",
    message: "Let the runtime finish",
    allowed: "tests/probe.ts",
  },
  {
    name: "environment",
    source: "export const value = process.env;",
    message: "Read environment",
    allowed: "src/config.ts",
  },
  {
    name: "executable",
    source: "export const value = process.execPath;",
    message: "Read environment",
    allowed: "src/config.ts",
  },
  {
    name: "stderr",
    source: "export const value = process.stderr;",
    message: "Only server.ts",
    allowed: "src/server.ts",
  },
  {
    name: "Node spawn",
    source: 'import { spawn } from "node:child_process"; export { spawn };',
    message: "Only run.ts",
    allowed: "src/run.ts",
  },
  {
    name: "unprefixed Node spawn",
    source: 'import { spawn } from "child_process"; export { spawn };',
    message: "Only run.ts",
    allowed: "src/run.ts",
  },
  {
    name: "Effect process",
    source: 'import { ChildProcess } from "effect/process"; export { ChildProcess };',
    message: "Only run.ts",
    allowed: "src/run.ts",
  },
  {
    name: "Effect subpath",
    source: 'export * from "effect/process/ChildProcessSpawner";',
    message: "Only run.ts",
    allowed: "src/run.ts",
  },
  {
    name: "literal dynamic import",
    source: 'void import("effect/process");',
    message: "Only run.ts",
    allowed: "src/run.ts",
  },
];

function lint(path: string, source: string) {
  const root = tempDir();
  const packageDir = join(root, "packages/mcp");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(root, "biome.json"), "{}");
  // Use the package's real plugin wiring with paths resolved in this temporary workspace.
  writeFileSync(join(packageDir, "biome.json"), readFileSync(join(pkg, "biome.json")));
  mkdirSync(join(packageDir, "biome-plugins"));
  writeFileSync(
    join(packageDir, "biome-plugins/boundaries.grit"),
    readFileSync(join(pkg, "biome-plugins/boundaries.grit")),
  );
  const file = join(packageDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${source}\n`);
  return spawnSync(join(pkg, "node_modules/.bin/biome"), ["lint", file], {
    cwd: packageDir,
    encoding: "utf8",
  });
}

it.each(probes)("Grit rejects $name outside its boundary", ({ source, message }) => {
  const result = lint("src/handlers.ts", source);
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain(message);
});

it.each(probes)("Grit allows $name at its boundary", ({ source, message, allowed }) => {
  const result = lint(allowed, source);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout + result.stderr).not.toContain(message);
});

it.each([
  'export const hint = "console.log(process.env); process.stdout; process.exit(0); process.execPath";',
  "// console.log(process.stderr); process.exit(0); process.env",
  "process.exitCode = 0;",
  "export const value = process.argv;",
])("Grit allows the near miss %s", (source) => {
  const result = lint("src/handlers.ts", source);
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
