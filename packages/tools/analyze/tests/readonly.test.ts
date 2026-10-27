import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "../src/cli";
import { DEFAULT_TOOLS_JSON_PATH } from "../src/core/tools";
import { main } from "../src/main";

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

function snapshotTree(root: string): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isDirectory()) {
        dirs.push(rel);
        walk(full);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  walk(root);
  return { files, dirs };
}

function hashTree(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const data = readFileSync(full);
        hashes.set(rel, createHash("sha256").update(data).digest("hex"));
      }
    }
  }
  walk(root);
  return hashes;
}

async function runMain(args: string[]): Promise<{ outcome: unknown; stderr: string }> {
  const parsed = parse(args);
  if (!parsed.ok) throw new Error(parsed.reason);
  const stderr: string[] = [];
  const outcome = await main(parsed.parsed, {
    writers: {
      stdout: () => {},
      stderr: (s) => {
        stderr.push(s);
      },
    },
    toolsJsonPath: DEFAULT_TOOLS_JSON_PATH,
  });
  return { outcome, stderr: stderr.join("") };
}

describe("analysis never writes into the target", () => {
  test("running ruff over a copy leaves the file set and contents unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "readonly-ruff-"));
    try {
      copyTree(TREE, dir);
      const before = snapshotTree(dir);
      const beforeHashes = hashTree(dir);

      const { outcome } = await runMain([dir, "--tool", "ruff"]);
      expect(outcome).toEqual({ ok: true, written: true });

      const after = snapshotTree(dir);
      const afterHashes = hashTree(dir);
      expect(after.files).toEqual(before.files);
      expect(after.dirs).toEqual(before.dirs);
      expect(after.files.length).toBe(before.files.length);
      expect(afterHashes).toEqual(beforeHashes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("running ruff over a copy does not create a .ruff_cache directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "readonly-cache-"));
    try {
      copyTree(TREE, dir);
      await runMain([dir, "--tool", "ruff"]);

      const cachePath = join(dir, ".ruff_cache");
      let exists = false;
      try {
        statSync(cachePath);
        exists = true;
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
