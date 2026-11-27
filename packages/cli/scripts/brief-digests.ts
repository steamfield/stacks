import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { BriefPreview } from "../src/schemas/validate";

const root = join(import.meta.dirname, "../../..");
const fixture = join(import.meta.dirname, "../tests/registry/fixtures/bundled-brief-digests.ts");
const decodePreview = Schema.decodeUnknownSync(Schema.fromJsonString(BriefPreview));

/** Hashes the canonical brief text as UTF-8, without adding a newline. */
export function briefDigest(key: string): string {
  const [stack = "", preset] = key.split(":");
  const result = spawnSync(
    "bun",
    [
      "run",
      "dev",
      "validate",
      "--brief",
      stack,
      ...(preset === "sandbox" ? ["--sandbox"] : []),
      "--json",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    const reason = result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`);
    throw new Error(`Could not produce brief for ${key}. ${reason}`);
  }
  try {
    const { brief } = decodePreview(result.stdout);
    return `sha256:${createHash("sha256").update(brief, "utf8").digest("hex")}`;
  } catch (cause) {
    throw new Error(`Could not decode brief for ${key}.`, { cause });
  }
}

export function rewriteDigests(file: string): void {
  const original = readFileSync(file, "utf8");
  const updated = original.replace(
    /\/\*[\s\S]*?\*\/|^([ \t]*"([\w-]+:(?:default|sandbox))":[ \t]*)"[^"\r\n]*"/gm,
    (row, prefix: string | undefined, key: string | undefined) =>
      prefix === undefined || key === undefined ? row : `${prefix}"${briefDigest(key)}"`,
  );
  if (updated !== original) writeFileSync(file, updated);
}

if (import.meta.main) rewriteDigests(fixture);
