import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { AgentId } from "@steamfield/stacks-format";
import { Effect, Exit, Schema } from "effect";
import { expect } from "vitest";
import { fingerprint } from "../../src/core/fingerprint";
import { BriefPreview } from "../../src/schemas/validate";
import { bundledAt, composeExit } from "./compose";
import { minimal, writeEntry } from "./registry";
import { reviewSearchFixture } from "./search-fixture";

export const setupBody = "## Setup\n\nBuild the small public interface.\n";
const steps = [
  "verify:",
  '  - { name: install, phase: setup, layer: install, run: "true # install" }',
  '  - { name: lint, layer: lint, run: "true # lint" }',
  '  - { name: typecheck, layer: typecheck, run: "true # typecheck" }',
  '  - { name: test, layer: test, run: "true # test" }',
].join("\n");

/** A clean stack, so preview findings cannot come from an incomplete fixture. */
export function stack(root: string, id = "sample", extra = "", body = setupBody) {
  return writeEntry({
    root,
    kind: "stack",
    dir: id,
    frontmatter: minimal("stack", id, `tags: [cli, scripts]\n${steps}\n${extra}`),
    body,
  });
}
/** A checked fragment, so preview findings cannot come from a missing verify step. */
export function fragment(root: string, id: string, extra = "", body = "# Fragment guidance\n") {
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

export function bundledStack(...options: Parameters<typeof stack>) {
  const entry = stack(...options);
  reviewSearchFixture(options[0]);
  return entry;
}

export function bundledFragment(...options: Parameters<typeof fragment>) {
  const entry = fragment(...options);
  reviewSearchFixture(options[0]);
  return entry;
}
export function shipped(entry: string, source: string, text = "fixture\n") {
  const path = join(entry, source);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
export function settings(home: string, value: unknown) {
  const dir = join(home, "config", "stacks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(value));
}

export async function fingerprintFor(
  root: string,
  options: {
    stack?: string;
    preset?: "default" | "sandbox";
    agents?: AgentId[];
    with?: string[];
    without?: string[];
  } = {},
) {
  const composed = await composeExit(
    { stack: "sample", preset: "sandbox", agents: ["claude"], ...options },
    { roots: bundledAt(root) },
  );
  if (Exit.isFailure(composed))
    throw new Error(`Fixture composition failed: ${JSON.stringify(composed)}`);
  return Effect.runPromise(fingerprint(composed.value).pipe(Effect.provide(NodeServices.layer)));
}

type Run = { status: number; stdout: string; stderr: string };
export function success(run: Run) {
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout.trim().split("\n")).toHaveLength(1);
}
export async function showReport(run: Run) {
  success(run);
  const { ShowReport } = await import("../../src/schemas/show");
  return Schema.decodeUnknownSync(ShowReport, { onExcessProperty: "error" })(
    JSON.parse(run.stdout),
  );
}
export function previewResult(run: Run) {
  success(run);
  return Schema.decodeUnknownSync(BriefPreview, { onExcessProperty: "error" })(
    JSON.parse(run.stdout),
  );
}
export function failure(run: Run, tag: string, details?: Record<string, unknown>) {
  expect(run.status).toBe(2);
  expect(run.stdout).toBe("");
  expect(run.stderr.trim().split("\n")).toHaveLength(1);
  const envelope: unknown = JSON.parse(run.stderr);
  expect(envelope).toMatchObject({
    error: { tag, retryable: false, ...(details ? { details } : {}) },
  });
}

/** Bytes, modes and link targets; reading never follows a link. */
export function snapshot(root: string, relative = ""): unknown[] {
  return readdirSync(join(root, relative))
    .sort()
    .flatMap((name): unknown[] => {
      const path = relative ? `${relative}/${name}` : name;
      const absolute = join(root, path);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) return [{ path, mode: stat.mode, link: readlinkSync(absolute) }];
      if (stat.isDirectory()) return [{ path, mode: stat.mode }, ...snapshot(root, path)];
      return [{ path, mode: stat.mode, bytes: readFileSync(absolute).toString("hex") }];
    });
}
