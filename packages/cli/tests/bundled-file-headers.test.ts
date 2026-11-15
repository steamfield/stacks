import { readdirSync, readFileSync } from "node:fs";
import { join, relative, win32 } from "node:path";
import { outputPath, shippedPath } from "@steamfield/stacks-format";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { splitFrontmatter } from "../src/core/registry/entry";

const registry = join(import.meta.dirname, "../registry");
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
  ".claude",
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return excluded.has(entry.name) ? [] : walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function checksPath(path: string): boolean {
  const parts = path.split("/");
  const root = parts.findIndex((part) => part === "src" || part === "scripts" || part === "tests");
  if (root < 0 || parts.slice(root).some((part) => excluded.has(part))) return false;
  if (parts[root] === "tests" && parts[root + 1] === "consumer") return false;
  const name = parts.at(-1) ?? "";
  return (
    /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) &&
    !name.endsWith(".d.ts") &&
    !name.includes(".gen.")
  );
}

function shipsCodeDocs(dir: string): boolean {
  const frontmatter = splitFrontmatter(readFileSync(join(dir, "STACK.md"), "utf8"));
  if (!frontmatter) throw new Error(`Missing frontmatter: ${dir}`);
  const meta: unknown = parse(frontmatter.frontmatter);
  if (typeof meta !== "object" || meta === null || !("fragments" in meta)) return false;
  const fragments = meta.fragments;
  if (typeof fragments !== "object" || fragments === null || !("default" in fragments))
    return false;
  return Array.isArray(fragments.default) && fragments.default.includes("code-docs");
}

function registryPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function shippedSources(kind: "fragments" | "stacks"): string[] {
  const root = join(registry, kind);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(root, entry.name);
      if (kind === "stacks" && !shipsCodeDocs(dir)) return [];
      return walk(dir).filter((file) => {
        const shipped = shippedPath(registryPath(relative(dir, file)));
        return (
          shipped !== undefined &&
          shipped.condition?.kind !== "agent" &&
          checksPath(outputPath(shipped.path))
        );
      });
    });
}

test("maps Windows entry paths to shipped paths", () => {
  const source = win32.relative(
    "C:\\registry\\fragment",
    "C:\\registry\\fragment\\files\\src\\index.ts.tmpl",
  );
  expect(shippedPath(registryPath(source))?.path).toBe("src/index.ts.tmpl");
});

const files = [...shippedSources("fragments"), ...shippedSources("stacks")].sort();

test.each(files.map((file) => [relative(registry, file), file]))(
  "%s ships a file header",
  (_name, file) => {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    if (lines[0]?.startsWith("#!")) lines.shift();
    expect(lines.find((line) => line.trim() !== "")?.startsWith("/**")).toBe(true);
    // The shipped checker also rejects blank lines before the comment.
    expect(lines[0]?.startsWith("/**")).toBe(true);
  },
);
