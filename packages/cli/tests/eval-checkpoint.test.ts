import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { validateEvalReport } from "../registry/fragments/openrouter-ai/files/scripts/lib/eval-report";
import { spawnGit } from "./helpers/git";
import { adapterWorkspace, scaffoldAdapters } from "./helpers/native-adapters";
import { readManifestAt } from "./helpers/verify";

const space = adapterWorkspace();
let composed = "";
beforeAll(async () => {
  const result = await scaffoldAdapters({
    home: space.temp(),
    stack: "react-router",
    fragments: ["openrouter-chat"],
    agents: ["codex"],
  });
  composed = result.project;
});
afterAll(() => space.cleanup());

function fixture(scenario = "success") {
  const root = space.temp();
  const project = join(root, "fixture");
  mkdirSync(project);
  cpSync(join(composed, "scripts"), join(project, "scripts"), { recursive: true });
  cpSync(join(import.meta.dirname, "fixtures/eval-checkpoint"), join(project, "scripts"), {
    recursive: true,
  });
  mkdirSync(join(root, "tmp"));
  writeFileSync(
    join(project, ".env"),
    "OPENROUTER_API_KEY=dotenv-dummy\nOPENAI_BASE_URL=https://example.invalid\n",
  );
  writeFileSync(join(project, ".gitignore"), ".eval/\n");
  expect(spawnGit(["init", "--quiet"], { cwd: project }).status).toBe(0);
  const env = {
    HOME: root,
    PATH: process.env.PATH ?? "",
    TMPDIR: join(root, "tmp"),
    CHECKPOINT_SCENARIO: scenario,
    OPENROUTER_API_KEY: "inherited-dummy",
    OPENROUTER_BASE_URL: "https://example.invalid",
    NEXT_PUBLIC_OPENROUTER_API_KEY: "prefixed-dummy",
    VITE_OPENROUTER_BASE_URL: "https://example.invalid",
    OPENAI_API_KEY: "sdk-dummy",
    OPENAI_BASE_URL: "https://example.invalid",
    AZURE_OPENAI_API_KEY: "azure-dummy",
    SDK_OPENAI_BASE_URL: "https://example.invalid",
  };
  return { root, project, env };
}

function run(value: ReturnType<typeof fixture>) {
  const result = spawnSync("bun", ["scripts/check-eval-dry-run.ts"], {
    cwd: value.project,
    env: value.env,
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const reportPath = readFileSync(join(value.project, "handoff-path.txt"), "utf8");
  expect(existsSync(dirname(reportPath))).toBe(false);
  expect(readdirSync(join(value.root, "tmp"))).toEqual([]);
  expect(result.stdout + result.stderr).not.toMatch(
    /provider-controlled|inherited-dummy|dotenv-dummy|example\.invalid/,
  );
  return result;
}

function artifact(project: string, output: string) {
  const path = output.trim();
  expect(path).toMatch(
    /^\.eval\/results\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z-[a-f0-9-]+\.json$/,
  );
  const value: unknown = JSON.parse(readFileSync(join(project, path), "utf8"));
  return value;
}

test("composed checkpoint calls a real application HTTP boundary, isolates env and retains unique artifacts", () => {
  const value = fixture();
  const first = run(value);
  expect(first.status).toBe(0);
  expect(first.stderr).toBe("");
  expect(
    validateEvalReport(artifact(value.project, first.stdout), [
      "synthetic/model-a",
      "synthetic/model-b",
    ]).issues,
  ).toEqual([]);
  expect(JSON.parse(readFileSync(join(value.project, "env-names.json"), "utf8"))).toEqual([]);
  const calls = readFileSync(join(value.project, "application-calls.txt"), "utf8")
    .trim()
    .split("\n");
  expect(calls).toEqual([
    "synthetic/model-a:currentTime",
    "synthetic/model-a:concise-answer",
    "synthetic/model-a:extract",
    "synthetic/model-b:currentTime",
    "synthetic/model-b:concise-answer",
    "synthetic/model-b:extract",
  ]);
  const second = run(value);
  expect(second.status).toBe(0);
  expect(second.stdout).not.toBe(first.stdout);
  expect(readdirSync(join(value.project, ".eval/results"))).toHaveLength(2);
  const ignored = spawnGit(["check-ignore", ".eval/results/anything.json"], {
    cwd: value.project,
    encoding: "utf8",
  });
  expect(ignored.status).toBe(0);
  expect(ignored.stdout.toString().trim()).toBe(".eval/results/anything.json");
});

test.each([
  "failed-outcome",
  "error-outcome",
  "no-pass",
  "aggregate",
  "live",
  "stale",
  "future",
  "child-failure",
])("rejects %s and preserves a structurally valid diagnostic artifact", (scenario) => {
  const value = fixture(scenario);
  const result = run(value);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/eval (report|runner):/);
  expect(validateEvalReport(artifact(value.project, result.stdout)).report).not.toBeNull();
  if (scenario === "child-failure")
    expect(result.stderr).toContain("eval runner: unsuccessful exit");
  if (scenario === "aggregate")
    expect(result.stderr).toContain("models[0].cost: aggregate mismatch");
  if (scenario === "stale") expect(result.stderr).toContain("createdAt: stale or future report");
});

test.each([
  "malformed",
  "oversized",
  "symlink",
  "directory",
  "no-report",
  "child-failure-no-report",
])("rejects %s without unsafe diagnostics or retained garbage", (scenario) => {
  const value = fixture(scenario);
  const result = run(value);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(
    "eval report: missing, unreadable, symlink, oversized or invalid JSON",
  );
  expect(existsSync(join(value.project, ".eval/results"))).toBe(false);
  if (scenario === "symlink")
    expect(existsSync(join(value.project, "symlink-target.json"))).toBe(true);
  if (scenario === "child-failure-no-report")
    expect(result.stderr).toContain("eval runner: unsuccessful exit");
});

test("rejects the saved Terra report even when its runner exits zero", () => {
  const value = fixture("supplied");
  const evidence = readFileSync(
    join(import.meta.dirname, "fixtures/eval-dry-run-terra.txt"),
    "utf8",
  );
  const last = evidence.trim().split("\n").at(-1);
  if (!last) throw new Error("missing evidence");
  writeFileSync(join(value.project, "input-report.json"), last);
  const result = run(value);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("eval report: schemaVersion: invalid or missing field\n");
});

test("vendor-only compositions ship the same helpers without adding an eval verify step", async () => {
  const value = await scaffoldAdapters({
    home: space.temp(),
    stack: "typescript-cli",
    fragments: ["openrouter-ai"],
    agents: ["codex"],
  });
  expect(
    readManifestAt(value.project).verify.some((step) => step.name === "app-eval-dry-run"),
  ).toBe(false);
  for (const path of [
    "scripts/check-eval-dry-run.ts",
    "scripts/lib/eval-report.ts",
    "docs/eval-report.md",
  ]) {
    expect(readFileSync(join(value.project, path), "utf8")).toBe(
      readFileSync(join(composed, path), "utf8"),
    );
  }
});
