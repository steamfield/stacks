import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { tempDir } from "./helpers/cli";

const pkg = join(import.meta.dirname, "..");

const moduleLocations = ["url", "dirname", "filename"] as const;
const moduleLocationMessage =
  "Resolve paths from the module location only in bin.ts; pass them through Host.";

const nodeProcess = [
  'process.kill(1, "SIGTERM");',
  'process.on("SIGINT", () => {});',
  "process.exit(1);",
  'process.once("exit", () => {});',
  'process.off("SIGINT", () => {});',
  'process.addListener("SIGTERM", () => {});',
  'process.removeListener("SIGTERM", () => {});',
  'process.prependListener("SIGHUP", () => {});',
  'import { kill } from "node:process"; export { kill };',
  'import { spawn } from "node:child_process"; export { spawn };',
  'import { spawn } from "child_process"; export { spawn };',
  'import { NodeServices } from "@effect/platform-node"; export { NodeServices };',
] as const;
const probes = [
  ['import { x } from "bun"; export { x };', "Platform code belongs"],
  ['import { x } from "zod"; export { x };', "Use Schema from effect"],
  ['console.log("x");', "Results use Output"],
  ["export const value = process.env;", "Read environment"],
  ["export const value = process.stdout;", "Only bin.ts"],
  ["export const value = process.stderr;", "Use Output.note"],
  ["export const value = Bun.version;", "The Bun global"],
  ...nodeProcess.map((source) => [source, "Node process APIs belong"] as const),
] as const;
/** Lints `source` written to `path` under a temporary root with only the boundary plugin. */
function lint(path: string, source: string, plugin = "biome-plugins/boundaries.grit") {
  const dir = tempDir();
  try {
    mkdirSync(join(dir.path, path, ".."), { recursive: true });
    writeFileSync(join(dir.path, "biome.json"), JSON.stringify({ plugins: [join(pkg, plugin)] }));
    const file = join(dir.path, path);
    writeFileSync(file, `${source}\n`);
    return spawnSync(join(pkg, "node_modules/.bin/biome"), ["lint", file], {
      cwd: dir.path,
      encoding: "utf8",
    });
  } finally {
    dir.cleanup();
  }
}
function lintWorkspace(path: string, source: string) {
  const dir = tempDir();
  try {
    const configs = [
      ["../../.gitignore", ".gitignore"],
      ["../../biome.json", "biome.json"],
      [
        "../../biome-plugins/no-cross-package-imports.grit",
        "biome-plugins/no-cross-package-imports.grit",
      ],
      ["biome.json", "packages/cli/biome.json"],
      ["biome-plugins/boundaries.grit", "packages/cli/biome-plugins/boundaries.grit"],
      ["../format/biome.json", "packages/format/biome.json"],
      [
        "../format/biome-plugins/no-platform-imports.grit",
        "packages/format/biome-plugins/no-platform-imports.grit",
      ],
    ] as const;
    for (const [source, target] of configs) {
      mkdirSync(join(dir.path, target, ".."), { recursive: true });
      copyFileSync(join(pkg, source), join(dir.path, target));
    }
    mkdirSync(join(dir.path, path, ".."), { recursive: true });
    const file = join(dir.path, path);
    writeFileSync(file, `${source}\n`);
    let configRoot = dir.path;
    if (path.startsWith("packages/cli/")) configRoot = join(dir.path, "packages/cli");
    if (path.startsWith("packages/format/")) configRoot = join(dir.path, "packages/format");
    return spawnSync(join(pkg, "node_modules/.bin/biome"), ["lint", relative(configRoot, file)], {
      cwd: configRoot,
      encoding: "utf8",
    });
  } finally {
    dir.cleanup();
  }
}
test.each(probes)("Grit enforces %s", (source, message) => {
  const result = lint("src/core/probe.ts", source);
  expect(result.stdout + result.stderr).toContain(message);
  expect(result.status).not.toBe(0);
});
test.each(["typescript-cli", "typescript-mcp"])(
  "%s starter Grit rejects console and misplaced env reads, allowing near misses",
  (stack) => {
    const plugin = `registry/stacks/${stack}/files/biome-plugins/boundaries.grit`;
    for (const { source, nearMiss, message } of [
      {
        source: 'console.log("x");',
        nearMiss: 'export const hint = "console.log(x)";',
        message: "never console",
      },
      {
        source: "export const value = process.env;",
        nearMiss: "export const value = process.env;",
        message: "Read environment",
      },
    ]) {
      const denied = lint("src/handlers.ts", source, plugin);
      expect(denied.stdout + denied.stderr).toContain(message);
      expect(denied.status).not.toBe(0);
      const allowed = lint("src/config.ts", nearMiss, plugin);
      expect(allowed.stdout + allowed.stderr).not.toContain(message);
      expect(allowed.status).toBe(0);
    }
  },
);
test.each([
  ["console reference", "export const value = console.error;", "never console"],
  ["stdout", "export const value = process.stdout;", "Stdout belongs to the MCP transport"],
  ["exit", "process.exit(0);", "Let the runtime finish"],
])("typescript-mcp starter Grit rejects %s only under src", (_name, source, message) => {
  const plugin = "registry/stacks/typescript-mcp/files/biome-plugins/boundaries.grit";
  const denied = lint("src/server.ts", source, plugin);
  expect(denied.stdout + denied.stderr).toContain(message);
  expect(denied.status).not.toBe(0);
  const allowed = lint("tests/server.test.ts", source, plugin);
  expect(allowed.stdout + allowed.stderr).not.toContain(message);
  expect(allowed.status).toBe(0);
});
test.each([
  "export const value = process.stderr;",
  "process.exitCode = 0;",
  "export const value = process.argv;",
  'export const hint = "process.stdout; process.exit(0); console.log(x); process.env";',
  "// console.log(process.env); process.exit(0); process.stdout",
])("typescript-mcp starter Grit allows the near miss %s", (source) => {
  const result = lint(
    "src/server.ts",
    source,
    "registry/stacks/typescript-mcp/files/biome-plugins/boundaries.grit",
  );
  expect(result.stdout + result.stderr).not.toContain("plugin");
  expect(result.status).toBe(0);
});
test("a verify probe that imports @effect/platform-node fails lint [1.3a#20]", () => {
  const result = lint(
    "src/core/verify/probe.ts",
    'import { NodeHttpClient } from "@effect/platform-node"; export { NodeHttpClient };',
  );
  expect(result.stdout + result.stderr).toContain("Node process APIs belong");
  expect(result.status).not.toBe(0);
});
test("core/verify/probe.ts imports nothing from node: or @effect/platform-node [1.3a#20]", () => {
  const source = readFileSync(join(pkg, "src/core/verify/probe.ts"), "utf8");
  const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
  expect(specifiers.length).toBeGreaterThan(0);
  expect(
    specifiers.filter(
      (name) =>
        name.startsWith("node:") ||
        name.startsWith("@effect/platform-node") ||
        name.startsWith("@effect/platform-bun"),
    ),
  ).toEqual([]);
});
test.each(nodeProcess)("Grit allows %s in src/platform/process.ts", (source) => {
  const result = lint("src/platform/process.ts", source);
  expect(result.stdout + result.stderr).not.toContain("Node process APIs belong");
  expect(result.status).toBe(0);
});
test.each(moduleLocations)("Grit rejects import.meta.%s in a service", (property) => {
  const result = lint("src/services/host.ts", `export const value = import.meta.${property};`);
  expect(result.stdout + result.stderr).toContain(moduleLocationMessage);
  expect(result.status).not.toBe(0);
});
test.each(moduleLocations)("Grit allows import.meta.%s in bin.ts", (property) => {
  const result = lint("src/bin.ts", `export const value = import.meta.${property};`);
  expect(result.stdout + result.stderr).not.toContain(moduleLocationMessage);
  expect(result.status).toBe(0);
});

const layerMessage = "Core and services cannot import platform or commands";
const builtinMessage = "Core and services use Effect services for Node APIs";
const packageMessage = "Workspace packages expose public package imports";

test.each([
  [
    "static import",
    "packages/cli/src/core/check.ts",
    'import { x } from "../platform/net"; export { x };',
  ],
  [
    "import type",
    "packages/cli/src/core/check.ts",
    'import type { X } from "../commands/root"; export type Y = X;',
  ],
  ["export star", "packages/cli/src/core/check.ts", 'export * from "../platform/net";'],
  [
    "named re-export",
    "packages/cli/src/services/check.ts",
    'export { x } from "../commands/root";',
  ],
  ["literal import", "packages/cli/src/core/search/check.ts", 'void import("../../platform/net");'],
])("Grit rejects %s across the core layer", (_name, path, source) => {
  const result = lintWorkspace(path, source);
  expect(result.stdout + result.stderr).toContain(layerMessage);
  expect(result.status).not.toBe(0);
});

test.each([
  ["packages/cli/src/core/check.ts", 'export * from "./platform/net";'],
  ["packages/cli/src/core/search/check.ts", 'export * from "../platform/net";'],
  ["packages/cli/src/commands/check.ts", 'export * from "../platform/net";'],
  [
    "packages/cli/src/services/processes.ts",
    'import { spawnChild } from "../platform/process"; export { spawnChild };',
  ],
])("Grit allows the local or exempt layer import from %s", (path, source) => {
  const result = lintWorkspace(path, source);
  expect(result.stdout + result.stderr).not.toContain(layerMessage);
  expect(result.status).toBe(0);
});

test("Grit rejects re-exporting the platform adapter from processes.ts", () => {
  const result = lintWorkspace(
    "packages/cli/src/services/processes.ts",
    'export * from "../platform/process";',
  );
  expect(result.stdout + result.stderr).toContain(layerMessage);
  expect(result.status).not.toBe(0);
});

test("Grit rejects another service importing the process adapter", () => {
  const result = lintWorkspace(
    "packages/cli/src/services/check.ts",
    'import { spawnChild } from "../platform/process"; export { spawnChild };',
  );
  expect(result.stdout + result.stderr).toContain(layerMessage);
  expect(result.status).not.toBe(0);
});

test.each([
  ["packages/cli/src/core/check.ts", 'export * from "node:fs";'],
  ["packages/cli/src/services/check.ts", 'export * from "fs/promises";'],
  ["packages/cli/src/core/check.ts", 'void import("node:os");'],
  ["packages/cli/src/core/check.ts", 'export * from "crypto";'],
  ["packages/cli/src/core/check.ts", 'export * from "inspector";'],
  ["packages/cli/src/services/check.ts", 'export * from "inspector/promises";'],
])("Grit rejects Node builtin in %s: %s", (path, source) => {
  const result = lintWorkspace(path, source);
  expect(result.stdout + result.stderr).toContain(builtinMessage);
  expect(result.status).not.toBe(0);
});

test.each([
  ["packages/cli/src/core/manifest.ts", "node:crypto"],
  ["packages/cli/src/core/fingerprint.ts", "node:crypto"],
  ["packages/cli/src/core/search/digest.ts", "node:crypto"],
  ["packages/cli/src/services/output.ts", "node:util"],
  ["packages/cli/src/core/scaffold/write.ts", "node:fs/promises"],
])("Grit allows %s in %s and rejects its sibling", (owner, builtin) => {
  const allowed = lintWorkspace(owner, `export * from "${builtin}";`);
  expect(allowed.stdout + allowed.stderr).not.toContain(builtinMessage);
  expect(allowed.status).toBe(0);
  const sibling = owner.replace(/\.ts$/, "-sibling.ts");
  const denied = lintWorkspace(sibling, `export * from "${builtin}";`);
  expect(denied.stdout + denied.stderr).toContain(builtinMessage);
  expect(denied.status).not.toBe(0);
});

test.each([
  [
    "packages/format/src/check.ts",
    'import { x } from "../../cli/src/core/manifest"; export { x };',
  ],
  [
    "packages/cli/tests/check.ts",
    'import type { X } from "../../format/src/index"; export type Y = X;',
  ],
  ["packages/format/src/check.ts", 'export * from "../../cli/src/core/manifest";'],
  ["packages/cli/tests/check.ts", 'export { x } from "../../format/src/index";'],
  ["packages/cli/tests/check.ts", 'export * from "../../format/src/index";'],
  ["packages/cli/tests/check.ts", 'export * from "../../format/scripts/pack";'],
  ["tests/check.ts", 'export * from "../packages/format/src/index";'],
  ["scripts/check.ts", 'void import("../packages/cli/src/bin");'],
  ["packages/cli/src/check.ts", 'export * from "@steamfield/stacks-format/src/index";'],
])("Grit rejects cross-package import in %s: %s", (path, source) => {
  const result = lintWorkspace(path, source);
  expect(result.stdout + result.stderr).toContain(packageMessage);
  expect(result.status).not.toBe(0);
});

test.each([
  [
    "packages/cli/registry/stacks/example/files/src/index.ts",
    'export * from "../../../../../../format/src/index";',
  ],
  ["packages/cli/tests/check.ts", 'export * from "@steamfield/stacks-format";'],
  ["packages/cli/src/check.ts", 'export * from "./core/manifest";'],
  ["tests/check.ts", 'export { default } from "../packages/cli/package.json";'],
])("Grit allows the public, local or registry import in %s", (path, source) => {
  const result = lintWorkspace(path, source);
  expect(result.stdout + result.stderr).not.toContain(packageMessage);
  expect(result.status).toBe(0);
});

test("computed import() is an allowed known gap", () => {
  const result = lintWorkspace(
    "packages/cli/tests/check.ts",
    'const target = "../../format/src/index"; void import(target);',
  );
  expect(result.stdout + result.stderr).not.toContain(packageMessage);
  expect(result.status).toBe(0);
});
