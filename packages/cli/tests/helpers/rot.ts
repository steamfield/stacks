import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { expect } from "vitest";
import { type Finding, ValidateReport } from "../../src/schemas/validate";
import { quiet, runCli, tempDir } from "./cli";
import { emptyRegistry, minimal, writeEntry } from "./registry";

export const setupBody = "## Setup\n\nCreate the project.\n";
const steps = [
  "verify:",
  '  - { name: install, phase: setup, layer: install, run: "true # install" }',
  '  - { name: lint, layer: lint, run: "true # lint" }',
  '  - { name: typecheck, layer: typecheck, run: "true # typecheck" }',
  '  - { name: test, layer: test, run: "true # test" }',
].join("\n");

export function stack(root: string, id = "sample", extra = "", body = setupBody) {
  return writeEntry({
    root,
    kind: "stack",
    dir: id,
    frontmatter: minimal("stack", id, `tags: [cli, scripts]\n${steps}\n${extra}`),
    body,
  });
}

export function fragment(root: string, id: string, extra = "", body = "# Guidance\n") {
  const checked = extra.includes("verify:")
    ? extra
    : `${extra}\nverify:\n  - { name: fixture-${id}, layer: check, run: "true # ${id}" }`;
  return writeEntry({
    root,
    kind: "fragment",
    dir: id,
    frontmatter: minimal("fragment", id, checked),
    body,
  });
}

export function ship(entry: string, source: string, text: string) {
  const path = join(entry, source);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

export function lineOf(file: string, text: string) {
  const line = readFileSync(file, "utf8")
    .split("\n")
    .findIndex((value) => value.includes(text));
  if (line < 0) throw new Error(`Fixture line not found in ${file}: ${text}`);
  return line + 1;
}

export function rotWorkspace() {
  const dirs: ReturnType<typeof tempDir>[] = [];
  return {
    temp() {
      const dir = tempDir();
      dirs.push(dir);
      return dir.path;
    },
    cleanup() {
      for (const dir of dirs.splice(0)) dir.cleanup();
    },
  };
}

/** Decode the real CLI report and check both streams, including kept-result errors. */
export async function validateRot(
  root: string,
  options: { home: string; bundled?: boolean; env?: Record<string, string>; cwd?: string },
) {
  const result = await runCli(["validate", root, "--json"], {
    home: options.home,
    env: { ...quiet, ...options.env },
    host: {
      cwd: options.cwd ?? options.home,
      registry: options.bundled ? root : emptyRegistry,
    },
  });
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout));
  const errors = report.findings.filter((f) => f.severity === "error").length;
  const warnings = report.findings.filter((f) => f.severity === "warning").length;
  expect(result.status).toBe(errors ? 2 : 0);
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  if (errors) {
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        tag: "ValidationFailed",
        message: "Validation failed.",
        retryable: false,
        next: "fix the error findings in the report on stdout, then run stacks validate again.",
        details: { errors, warnings },
      },
    });
  } else expect(result.stderr).toBe("");
  return { ...result, report, errors, warnings };
}

type FindingLocation = Pick<Finding, "kind" | "entry" | "file" | "line"> & {
  text?: readonly string[];
};

/** Match an unordered multiset, including source identity and identifying message tokens. */
export function findingsAre(
  findings: readonly Finding[],
  expected: readonly (readonly [string, Finding["severity"], FindingLocation?])[],
) {
  expect(findings, JSON.stringify(findings)).toHaveLength(expected.length);
  const remaining = [...findings];
  for (const [check, severity, location = {}] of expected) {
    const index = remaining.findIndex(
      (finding) =>
        finding.check === check &&
        finding.severity === severity &&
        (location.kind === undefined || finding.kind === location.kind) &&
        (location.entry === undefined || finding.entry === location.entry) &&
        (location.file === undefined || finding.file === location.file) &&
        (location.line === undefined || finding.line === location.line) &&
        (location.text ?? []).every((token) => finding.message.includes(token)),
    );
    expect(
      index,
      JSON.stringify({ expected: [check, severity, location], remaining }),
    ).toBeGreaterThanOrEqual(0);
    remaining.splice(index, 1);
  }
}
