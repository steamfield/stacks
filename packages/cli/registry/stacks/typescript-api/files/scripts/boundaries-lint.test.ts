import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { REPO } from "./helpers/dev";

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function lint(path: string, source: string) {
  const dir = mkdtempSync(join(REPO, ".boundary-fixtures-"));
  fixtures.push(dir);
  const file = join(dir, path);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, source);
  const result = spawnSync(
    join(REPO, "node_modules/.bin/biome"),
    ["lint", "--reporter=json", file],
    { encoding: "utf8" },
  );
  if (!result.stdout) throw new Error(result.stderr);
  const parsed: unknown = JSON.parse(result.stdout);
  if (typeof parsed !== "object" || parsed === null || !("diagnostics" in parsed))
    throw new Error("No diagnostics in Biome report");
  const all = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
  // Only Grit diagnostics: a probe like `fetch(...)` also trips Biome's own rules (a floating
  // promise), which these tests don't measure.
  const diagnostics: unknown[] = all.filter(
    (diagnostic: unknown) =>
      typeof diagnostic === "object" &&
      diagnostic !== null &&
      "category" in diagnostic &&
      diagnostic.category === "plugin",
  );
  return { status: result.status, report: { diagnostics } };
}

it.each([
  ["src/service.ts", 'import "@effect/platform-node";'],
  ["src/service.ts", 'import "node:fs";'],
  ["src/service.ts", 'import "bun";'],
  ["src/service.ts", 'import "zod";'],
  ["src/service.ts", 'console.log("hello");'],
  ["src/service.ts", "process.env.PORT_API;"],
  ["src/service.ts", "process.exit(1);"],
  ["src/service.ts", "Bun.file('x');"],
])("%s rejects boundary violation %s with exactly one Grit diagnostic", (path, source) => {
  const { status, report } = lint(path, source);
  expect(status).toBe(1);
  expect(report).toMatchObject({
    diagnostics: [expect.objectContaining({ category: "plugin" })],
  });
  // A one-element equality also checks that overlapping rules don't report twice.
  if (typeof report !== "object" || report === null || !("diagnostics" in report))
    throw new Error("No diagnostics in Biome report");
  expect(report.diagnostics).toHaveLength(1);
});

const effect = 'import { Effect } from "effect";\n';
// The third column is a fragment of the branch's message, so a probe proves its own branch fired.
const api = "src/services/sample.ts";
it.each([
  [api, 'export const page = fetch("https://example.com");', "HttpClient"],
  [api, 'export const page = globalThis.fetch("https://example.com");', "HttpClient"],
  [api, 'import { Config } from "effect";\nConfig.String("TOKEN");', "yield AppConfig"],
  [api, "export const now = Date.now();", "Clock"],
  [api, "export const now = globalThis.Date.now();", "Clock"],
  [api, "export const now = new Date;", "Clock"],
  [api, "export const now = new Date();", "Clock"],
  [api, "export const roll = Math.random();", "Random"],
  [api, `${effect}export const run = Effect.runPromise(Effect.void);`, "platform entry runs"],
  [
    api,
    `${effect}export const run = (c: never) => Effect.runPromiseWith(c)(Effect.void);`,
    "platform entry runs",
  ],
  [api, `${effect}Effect.logInfo("dropped");`, "built and dropped"],
  [api, `${effect}Effect.logInfo("dropped").pipe(Effect.asVoid);`, "built and dropped"],
  [
    "src/handlers/sample.ts",
    'import { HttpServerResponse } from "effect/http";\nexport const r = HttpServerResponse.empty();',
    "bypasses the encoder",
  ],
])("%s rejects %s with exactly one Grit diagnostic", (path, source, message) => {
  const { status, report } = lint(path, source);
  expect(status).toBe(1);
  expect(report.diagnostics).toEqual([
    expect.objectContaining({ category: "plugin", message: expect.stringContaining(message) }),
  ]);
});

it.each([
  ["src/platform/sample.ts", 'import "node:fs";'],
  ["src/config.ts", 'import { Config } from "effect";\nexport const c = Config.String("X");'],
  ["src/platform/sample.ts", "export const now = Date.now();"],
  ["src/services/sample.ts", "export const at = new Date(0);"],
  ["src/platform/sample.ts", `${effect}export const run = Effect.runPromise(Effect.void);`],
  [
    "src/handlers/sample.ts",
    'import { HttpServerResponse } from "effect/http";\n// biome-ignore lint/plugin: streams a file\nexport const r = HttpServerResponse.empty();',
  ],
  [
    "src/services/sample.ts",
    `${effect}export const p = Effect.gen(function* () {\n  yield* Effect.logInfo("kept");\n});`,
  ],
  [
    "src/services/sample.ts",
    'import { HttpServerResponse } from "effect/http";\nexport const r = HttpServerResponse.empty();',
  ],
])("%s permits %s", (path, source) => {
  const { status, report } = lint(path, source);
  expect(status).toBe(0);
  expect(report).toMatchObject({ diagnostics: [] });
});
