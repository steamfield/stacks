// Probes biome-plugins/boundaries.grit on real files: each rule must fire where it should and stay
// quiet where the thing is allowed.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The plugin's messages for `source` written at `path` (relative to a src/-shaped fixture). */
function pluginMessages(path: string, source: string): string[] {
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
  return (report.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === "plugin")
    .map((diagnostic) => diagnostic.message ?? "");
}

test.each([
  ["src/x.ts", 'import { readFileSync } from "node:fs";', "platform neutral"],
  ["src/x.ts", 'export const load = () => import("bun");', "platform neutral"],
  ["src/index.ts", 'export { words } from "./internal/words.ts";', "src/internal/ is private"],
  ["src/x.ts", "export const debug = process.env.DEBUG;", "never reads the process"],
  ["src/x.ts", 'console.warn("deprecated");', "never writes to the console"],
  ["src/x.ts", 'throw new TypeError("bad input");', "LibraryError"],
  ["src/x.ts", "export default function slugify() {}", "Export by name"],
  ["src/x.ts", "const api = {};\nexport default api;", "Export by name"],
  ["src/index.ts", 'export * from "./slugify.ts";', "Export by name"],
])("%s: %s is rejected", (path, source, pointer) => {
  const messages = pluginMessages(path, source);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(pointer);
});

test.each([
  ["src/index.ts", 'export { slugify } from "./slugify.ts";'],
  ["src/slugify.ts", 'import { words } from "./internal/words.ts";'],
  ["src/x.ts", 'throw new LibraryError("invalid_input");'],
  ["src/x.test.ts", 'console.log("debugging a test");'],
  ["scripts/x.ts", 'import { join } from "node:path";\nconsole.log(process.cwd(), join("a"));'],
  ["tests/x.test.ts", 'throw new Error("fixture");'],
])("%s: %s is allowed", (path, source) => {
  expect(pluginMessages(path, source)).toEqual([]);
});
