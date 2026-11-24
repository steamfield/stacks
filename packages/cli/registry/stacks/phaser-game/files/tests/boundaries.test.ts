/**
 * Probes the boundary rules in biome.json with temporary source files: logic stays deterministic
 * and engine-free, only the shell writes to the console, and only the save kit touches storage.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The boundary diagnostics for `source` written at `path` inside a project-shaped fixture. */
function boundaryDiagnostics(path: string, source: string): string[] {
  const dir = mkdtempSync(join(ROOT, ".boundary-fixture-"));
  fixtures.push(dir);
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const biome = join(ROOT, "node_modules/.bin/biome");
  const result = spawnSync(biome, ["lint", "--reporter=json", file], { encoding: "utf8" });
  if (!result.stdout) throw new Error(result.stderr);
  const report = JSON.parse(result.stdout) as {
    diagnostics?: { category?: string; message?: string }[];
  };
  const boundary = /^(plugin|lint\/suspicious\/noConsole|lint\/style\/noRestricted)/;
  return (report.diagnostics ?? [])
    .filter((diagnostic) => boundary.test(diagnostic.category ?? ""))
    .map((diagnostic) => `${diagnostic.category}: ${diagnostic.message ?? ""}`);
}

test.each([
  ["src/logic/x.ts", "export const r = Math.random();", "createRng"],
  ["src/kit/core/x.ts", "export const t = Date.now();", "dt and tick"],
  ["src/logic/x.ts", "export const t = new Date();", "dt and tick"],
  ["src/logic/x.ts", 'import Phaser from "phaser";\nexport const p = Phaser;', "engine-free"],
  ["src/logic/x.ts", 'export { input } from "../engine/input.ts";', "plain data"],
  ["src/logic/x.ts", 'export { bootGame } from "../kit/shell.ts";', "plain data"],
  ["src/engine/x.ts", 'console.log("hello");', "noConsole"],
  // Biome puts the configured reason in the diagnostic's advice; the message names the global.
  ["src/engine/x.ts", 'localStorage.setItem("k", "v");', "global variable localStorage"],
])("%s: %s is rejected", (path, source, pointer) => {
  const found = boundaryDiagnostics(path, source);
  expect(found).toHaveLength(1);
  expect(found[0]).toContain(pointer);
});

test.each([
  ["src/logic/x.ts", 'export { createRng } from "../kit/core/index.ts";'],
  ["src/engine/x.ts", "export const r = Math.random();"],
  ["src/kit/shell.ts", 'console.info("record");'],
  ["src/kit/save.ts", "export const db = indexedDB;"],
  ["scripts/x.ts", 'console.log("outside src");'],
])("%s: %s is allowed", (path, source) => {
  expect(boundaryDiagnostics(path, source)).toEqual([]);
});
