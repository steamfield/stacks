#!/usr/bin/env bun
/**
 * Fails when src/api/generated/ differs from what `bun run generate:api` writes from the current
 * openapi.json. It runs the generator in a temporary copy of its inputs and compares the result,
 * so correct output passes whether or not it is committed, and the project is never written.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GENERATED = "src/api/generated";
const FIX = "run bun run generate:api, then commit it";
// What the generator reads: the script, Orval's config, the document and the mutator's directory.
const INPUTS = ["package.json", "tsconfig.json", "orval.config.ts", "openapi.json", "src/api"];

process.chdir(join(import.meta.dirname, ".."));

/** Every file under `dir`, as paths relative to it, sorted; empty when `dir` doesn't exist. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

/** What is wrong with the committed output against a fresh one, or undefined when they match. */
function firstDifference(committed: string, fresh: string): string | undefined {
  const want = listFiles(fresh);
  const have = listFiles(committed);
  if (have.length === 0) return `is missing: ${FIX}`;
  const missing = want.find((file) => !have.includes(file));
  if (missing) return `lacks ${missing}: ${FIX}`;
  const extra = have.find((file) => !want.includes(file));
  // Orval doesn't delete files it no longer writes, so regenerating alone won't fix this one.
  if (extra) return `has ${extra}, which the generator doesn't write: delete it and commit`;
  const changed = want.find(
    (file) => !readFileSync(join(committed, file)).equals(readFileSync(join(fresh, file))),
  );
  return changed && `has a stale ${changed}: ${FIX}`;
}

/** Copies the generator's inputs into `dir` and runs `generate:api` there; false if it failed. */
function generateInto(dir: string): boolean {
  for (const input of INPUTS) {
    if (!existsSync(input)) continue;
    const generated = resolve(GENERATED);
    cpSync(input, join(dir, input), {
      recursive: true,
      filter: (source) => !resolve(source).startsWith(generated),
    });
  }
  // The config imports orval, and the generated code's imports resolve against the same modules.
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
  const run = spawnSync("bun", ["run", "--silent", "generate:api"], { cwd: dir, encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status === 0) return true;
  process.stderr.write(`${run.stdout}${run.stderr}`);
  console.error(`bun run generate:api failed (exit ${run.status}): fix the error above first`);
  return false;
}

function check(): number {
  if (!existsSync("openapi.json")) {
    console.error("openapi.json is missing: copy the API's OpenAPI document here first");
    return 1;
  }
  if (!existsSync("node_modules")) {
    console.error("node_modules is missing: run bun install first");
    return 1;
  }
  const dir = mkdtempSync(join(tmpdir(), "api-client-"));
  const cleanUp = () => rmSync(dir, { recursive: true, force: true });
  // verify stops a step with SIGTERM on timeout; leave no copy behind.
  process.once("SIGTERM", () => {
    cleanUp();
    process.exit(143);
  });
  try {
    if (!generateInto(dir)) return 1;
    const difference = firstDifference(GENERATED, join(dir, GENERATED));
    if (!difference) return 0;
    console.error(`${GENERATED} ${difference}`);
    return 1;
  } finally {
    cleanUp();
  }
}

process.exitCode = check();
