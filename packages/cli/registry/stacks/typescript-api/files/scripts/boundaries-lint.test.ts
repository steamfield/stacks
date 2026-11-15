/**
 * Probes the project's Biome boundary rules with temporary source files.
 * These tooling tests keep runtime access and Effect conventions enforced as the app grows.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { REPO } from "./helpers/dev";

// One smoke probe per Grit diagnostic, rather than every spelling of each rule.
it.each([
  ["src/service.ts", 'import "node:fs";', "Runtime imports"],
  ["src/service.ts", 'import "zod";', "Use Schema"],
  ["src/service.ts", 'console.log("hello");', "never console"],
  ["src/services/sample.ts", 'export const page = fetch("https://example.com");', "HttpClient"],
  [
    "src/services/sample.ts",
    'import { Config } from "effect";\nConfig.String("TOKEN");',
    "yield AppConfig",
  ],
  ["src/services/sample.ts", "export const now = Date.now();", "Clock"],
  [
    "src/services/sample.ts",
    'import { Effect } from "effect";\nexport const run = Effect.runPromise(Effect.void);',
    "platform entry runs",
  ],
  [
    "src/services/sample.ts",
    'import { Effect } from "effect";\nEffect.logInfo("dropped");',
    "built and dropped",
  ],
  [
    "src/handlers/sample.ts",
    'import { HttpServerResponse } from "effect/http";\nexport const r = HttpServerResponse.empty();',
    "bypasses the encoder",
  ],
  ["src/service.ts", "process.env.PORT_API;", "reads process.env"],
  ["src/service.ts", "process.exit(1);", "process global"],
  ["src/service.ts", "Bun.file('x');", "Bun global"],
])("%s reports %s", (path, source, message) => {
  const dir = mkdtempSync(join(REPO, ".boundary-fixtures-"));
  try {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    const result = spawnSync(
      join(REPO, "node_modules/.bin/biome"),
      ["lint", "--reporter=json", file],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    const report: unknown = JSON.parse(result.stdout);
    if (
      typeof report !== "object" ||
      report === null ||
      !("diagnostics" in report) ||
      !Array.isArray(report.diagnostics)
    )
      throw new Error("No diagnostics in Biome report");
    const diagnostics: unknown[] = report.diagnostics.filter(
      (value: unknown) =>
        typeof value === "object" &&
        value !== null &&
        "category" in value &&
        value.category === "plugin",
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ category: "plugin", message: expect.stringContaining(message) }),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
