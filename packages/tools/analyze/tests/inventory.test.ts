import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { computeInventory } from "../src/core/inventory";

const TREE = join(import.meta.dirname, "fixtures", "tree");

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

describe("inventory tier 0", () => {
  const metrics = computeInventory(TREE, []);

  test("file count excludes node_modules", () => {
    expect(metrics.files).toBe(6);
  });

  test("line counts match hand-computed values", () => {
    expect(metrics.lines).toBe(46);
    expect(metrics.codeLines).toBe(29);
    expect(metrics.blankLines).toBe(6);
    expect(metrics.commentLines).toBe(6);
  });

  test("markers are counted across the tree", () => {
    expect(metrics.markers.TODO).toBe(3);
    expect(metrics.markers.FIXME).toBe(2);
    expect(metrics.markers.HACK).toBe(0);
    expect(metrics.markers.XXX).toBe(0);
  });

  test("language mix is a percentage of code lines", () => {
    expect(metrics.byLanguage.typescript).toBe(48);
    expect(metrics.byLanguage.python).toBe(22);
    expect(metrics.byLanguage.go).toBe(15);
  });

  test("test ratio uses the language naming convention", () => {
    expect(metrics.testFiles).toBe(1);
    expect(metrics.sourceFiles).toBe(3);
    expect(metrics.testRatio).toBeCloseTo(1 / 3, 4);
  });

  test("manifests are detected", () => {
    expect(metrics.manifests).toContain("package.json");
    expect(metrics.manifests).toContain("go.mod");
  });

  test("largest files are ordered by lines and capped at ten", () => {
    expect(metrics.largestFiles.length).toBe(6);
    expect(metrics.largestFiles[0]?.path).toBe("src/calc.py");
    expect(metrics.largestFiles[0]?.lines).toBe(11);
  });

  test("files by language counts every classified file", () => {
    expect(metrics.filesByLanguage.typescript).toBe(2);
    expect(metrics.filesByLanguage.python).toBe(1);
    expect(metrics.filesByLanguage.go).toBe(1);
    expect(metrics.filesByLanguage.json).toBe(1);
  });

  test("generated directories (.ruff_cache, __pycache__) do not change file counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "inv-gen-"));
    try {
      copyTree(TREE, dir);
      const before = computeInventory(dir, []);
      mkdirSync(join(dir, ".ruff_cache"), { recursive: true });
      mkdirSync(join(dir, ".ruff_cache", "0.15.10"), { recursive: true });
      writeFileSync(join(dir, ".ruff_cache", "CACHEDIR.TAG"), "tag\n", "utf8");
      writeFileSync(join(dir, ".ruff_cache", "0.15.10", "x"), "cache\n", "utf8");
      mkdirSync(join(dir, "__pycache__"), { recursive: true });
      writeFileSync(join(dir, "__pycache__", "calc.cpython.pyc"), "pyc\n", "utf8");
      const after = computeInventory(dir, []);
      expect(after.files).toBe(before.files);
      expect(after.lines).toBe(before.lines);
      expect(after.bytes).toBe(before.bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
