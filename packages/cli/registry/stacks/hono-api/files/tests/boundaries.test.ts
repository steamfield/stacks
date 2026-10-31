// Probes biome-plugins/boundaries.grit on real files: each rule must fire where it should and stay
// quiet in the one place the thing is allowed.
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
  ["src/app.ts", 'import { readFileSync } from "node:fs";', "src/server.ts"],
  ["src/routes/x.ts", 'import { serve } from "@hono/node-server";', "src/server.ts"],
  ["src/schemas/x.ts", 'import { z } from "zod";', "@hono/zod-openapi"],
  ["src/config.ts", "export const port = process.env.PORT;", "src/main.ts"],
  ["src/routes/x.ts", 'console.log("hello");', "pino"],
  ["src/routes/x.ts", "export const r = new OpenAPIHono();", "createRouter()"],
  ["src/routes/x.ts", 'app.get("/v1/things", (c) => c.json([]));', "createRoute()"],
  ["src/routes/x.ts", "export const h = async (c) => c.req.json();", "c.req.valid()"],
])("%s: %s is rejected", (path, source, pointer) => {
  const messages = pluginMessages(path, source);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(pointer);
});

test.each([
  ["src/server.ts", 'import { serve } from "@hono/node-server";'],
  ["src/main.ts", "export const env = process.env;"],
  ["src/router.ts", "export const r = new OpenAPIHono();"],
  ["src/routes/x.ts", "export const note = await store.get(id);"],
  ["src/routes/x.ts", 'export const h = (c) => c.req.valid("json");'],
  ["scripts/x.ts", 'console.log("outside src");'],
])("%s: %s is allowed", (path, source) => {
  expect(pluginMessages(path, source)).toEqual([]);
});
