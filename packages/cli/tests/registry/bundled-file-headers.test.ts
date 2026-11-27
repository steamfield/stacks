import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { outputPath, shippedPath } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { afterAll, expect, test } from "vitest";
import { decodeEntry } from "../../src/core/registry/entry";
import { bundled as registry } from "./helpers/bundled";

const checker = join(registry, "fragments/code-docs/files/scripts/check-file-headers.sh");
const temporary = mkdtempSync(join(tmpdir(), "bundled-file-headers-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

const excluded = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  ".venv",
  "vendor",
  "__pycache__",
  "fixtures",
  "__snapshots__",
  "generated",
  "__generated__",
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

// Only discovery is mirrored here; the shipped checker decides whether each header is valid.
function checksPath(path: string): boolean {
  const root = /^(?:(?:apps|packages)\/[^/.][^/]*\/)?(?:src|scripts|tests)\//.exec(path);
  if (!root || path.startsWith("tests/consumer/")) return false;
  const withinRoot = path.slice(root[0].length).split("/");
  if (withinRoot.slice(0, -1).some((part) => excluded.has(part))) return false;
  return (
    /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs)$/.test(path) &&
    !/(?:\.gen\.[^/]*|\.d\.ts|_pb2\.py|\.pb\.go|_templ\.go)$/.test(path)
  );
}

test.each([
  "src/index.ts",
  "scripts/index.js",
  "tests/test_index.py",
  "apps/web/src/index.tsx",
  "apps/web/scripts/index.mjs",
  "apps/web/tests/index.go",
  "packages/core/src/lib.rs",
  "packages/core/scripts/index.cts",
  "packages/core/tests/index.cjs",
  "src/index.mts",
  "src/index.jsx",
  "docs/src/index.ts",
  "apps/a/b/src/index.ts",
  "apps/.hidden/src/index.ts",
  "packages/.hidden/src/index.ts",
  ".claude/skills/tool/scripts/index.ts",
  "src/.claude/index.ts",
  "tests/consumer/index.ts",
  "apps/web/tests/consumer/index.ts",
  "src/tests/consumer/index.ts",
  "src/index.gen.ts",
  "src/index.d.ts",
  "src/example_pb2.py",
  "src/example.pb.go",
  "src/example_templ.go",
  ...[...excluded].map((dir) => `src/${dir}/index.ts`),
])("discovery agrees with the checker for %s", (path) => {
  const project = mkdtempSync(join(temporary, "discovery-"));
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  // Invalid in every supported language: a checked file must be reported as missing a header.
  writeFileSync(target, "missing header\n");
  const result = spawnSync("bash", [checker], { cwd: project, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.stdout).toBe("");
  expect(result.status).toBe(checksPath(path) ? 1 : 0);
  expect(result.stderr).toBe(checksPath(path) ? `${path}: missing file-level doc comment\n` : "");
});

const defaultStacks = readdirSync(join(registry, "stacks")).filter((id) => {
  const decoded = Effect.runSync(
    decodeEntry("stack", readFileSync(join(registry, "stacks", id, "STACK.md"), "utf8")),
  );
  expect(decoded._tag, `stacks/${id}/STACK.md decodes`).toBe("Meta");
  return (
    decoded._tag === "Meta" &&
    decoded.meta.kind === "stack" &&
    decoded.meta.fragments.default.includes("code-docs")
  );
});

function shippedSources(kind: "fragments" | "stacks") {
  const root = join(registry, kind);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(root, entry.name);
      if (kind === "stacks" && !defaultStacks.includes(entry.name)) return [];
      return walk(dir).flatMap((file) => {
        const shipped = shippedPath(relative(dir, file));
        if (!shipped || shipped.condition?.kind === "agent") return [];
        const path = outputPath(shipped.path);
        return checksPath(path) ? [{ name: relative(registry, file), file, path }] : [];
      });
    });
}

// Other stacks may opt into code-docs, which then reports their undocumented shipped files.
// This baseline covers every fragment and stacks that promise code-docs by default, both payloads.
const files = [...shippedSources("fragments"), ...shippedSources("stacks")].sort((a, b) =>
  a.name.localeCompare(b.name),
);

test("discovers shipped sources for every stack that defaults to code-docs", () => {
  expect(files.length).toBeGreaterThan(0);
  expect(defaultStacks.length).toBeGreaterThan(0);
  expect(
    new Set(
      files.filter(({ name }) => name.startsWith("stacks/")).map(({ name }) => name.split("/")[1]),
    ),
  ).toEqual(new Set(defaultStacks));
});

// Each row runs the real checker in an isolated project, so overlays and payloads cannot hide
// one another. This also uses its shebang, encoding, build-tag and empty __init__.py rules.
// The registry rows take about 4-8 seconds locally; each process has Vitest's 5-second budget.
for (const [index, { name, file, path }] of files.entries()) {
  test(`${name} ships a file header`, () => {
    const project = join(temporary, String(index));
    const target = join(project, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
    const result = spawnSync("bash", [checker], { cwd: project, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
}
