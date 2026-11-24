/**
 * Probes the Biome rules that keep the layers apart, with temporary source files: logic stays
 * deterministic and engine-free, only the shell writes to the console, and only the save kit
 * touches browser storage.
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

/** Biome's lint messages for `source` written at `path` inside a fresh project-shaped folder. */
function lintMessages(path: string, source: string): string[] {
  const dir = mkdtempSync(join(ROOT, ".boundary-fixture-"));
  fixtures.push(dir);
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const biome = join(ROOT, "node_modules/.bin/biome");
  const result = spawnSync(biome, ["lint", "--reporter=json", file], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (!result.stdout) throw new Error(result.stderr);
  const report = JSON.parse(result.stdout) as {
    diagnostics?: { category?: string; message?: string }[];
  };
  return (report.diagnostics ?? [])
    .filter((d) => d.category === "plugin" || d.category?.startsWith("lint/") === true)
    .filter((d) => d.category !== "lint/correctness/noUnusedImports")
    .map((d) => `${d.category}: ${d.message ?? ""}`);
}

test.each([
  ["src/logic/x.ts", "export const r = Math.random();", "Math.random()"],
  ["src/logic/x.ts", "export const t = Date.now();", "must not read the clock"],
  ["src/logic/x.ts", "export const d = new Date();", "must not read the clock"],
  ["src/logic/x.ts", 'export * from "three";', "engine-free"],
  ["src/logic/x.ts", 'export * from "@dimforge/rapier3d-compat";', "Physics belongs"],
  ["src/logic/x.ts", 'export * from "../kit/save.ts";', "only src/kit/core"],
  ["src/logic/x.ts", 'export * from "../engine/runtime.ts";', "must not depend on the engine"],
  ["src/engine/x.ts", 'console.log("hello");', "noConsole"],
  // Biome prints this rule's configured message as a note, so the main message names the global.
  ["src/engine/x.ts", "export const s = localStorage;", "noRestrictedGlobals"],
  ["tests/x.test.ts", 'import { it } from "vitest";\nit.only("x", () => {});', "noFocusedTests"],
])("%s: %s is rejected", (path, source, pointer) => {
  const messages = lintMessages(path, source);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(pointer);
});

test.each([
  ["src/logic/x.ts", 'export * from "../kit/core/index.ts";'],
  ["src/logic/x.ts", 'export * from "zod";'],
  ["src/engine/x.ts", "export const r = Math.random();"],
  ["src/engine/x.ts", 'export * from "three";'],
  ["src/kit/shell.ts", 'console.info("record");'],
  ["src/kit/save.ts", "export const db = indexedDB;"],
  ["scripts/x.ts", 'console.log("outside src");'],
])("%s: %s is allowed", (path, source) => {
  expect(lintMessages(path, source)).toEqual([]);
});
