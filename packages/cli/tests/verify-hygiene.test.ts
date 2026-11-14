import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { decodeResult, verify, workspace, writeProject } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

/** Code checks plus two hygiene checks that fail, as an unfilled marker or missing doc would. */
function project() {
  const root = space.dir();
  writeProject(root, [
    { name: "install", phase: "setup", layer: "install", run: "true" },
    { name: "test", phase: "check", layer: "test", run: "true" },
    {
      name: "readme-filled",
      phase: "check",
      layer: "check",
      tags: ["hygiene"],
      run: "touch ran-readme && false",
    },
    { name: "harness-doc-filled", phase: "check", layer: "check", tags: ["hygiene"], run: "false" },
  ]);
  return root;
}

test("plain verify runs the code checks only and is green while hygiene checks would fail", async () => {
  const root = project();
  const result = await verify(["--json"], { cwd: root });
  expect(result.status).toBe(0);
  const decoded = decodeResult(result.stdout);
  expect(decoded).toMatchObject({
    outcome: "green",
    scope: "full",
    totals: { passed: 2, failed: 0, skipped: 2 },
  });
  expect(decoded.steps.map((step) => [step.name, step.status])).toEqual([
    ["install", "passed"],
    ["test", "passed"],
    ["readme-filled", "skipped"],
    ["harness-doc-filled", "skipped"],
  ]);
  expect(existsSync(join(root, "ran-readme"))).toBe(false);
});

test("an agent's report folds the skipped hygiene checks into one line naming --all", async () => {
  const result = await verify([], { cwd: project() });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("verify: green (full run; 2 passed, 0 failed, 2 skipped;");
  expect(result.stdout).not.toContain("readme-filled");
  expect(result.stdout).toContain(
    "Skipped 2 hygiene checks (fill markers, harness, CI, hooks); stacks verify --all runs them.",
  );
});

test("verify --all runs the hygiene checks too and fails on them", async () => {
  const root = project();
  const result = await verify(["--all", "--json"], { cwd: root });
  expect(result.status).toBe(5);
  const decoded = decodeResult(result.stdout);
  expect(decoded).toMatchObject({
    outcome: "failed",
    totals: { passed: 2, failed: 2, skipped: 0 },
  });
  expect(existsSync(join(root, "ran-readme"))).toBe(true);
});

test("--only names one hygiene check and runs it, as a partial run", async () => {
  const result = await verify(["--only", "readme-filled", "--json"], { cwd: project() });
  const decoded = decodeResult(result.stdout);
  expect(decoded.scope).toBe("partial");
  expect(decoded.steps.find((step) => step.name === "readme-filled")?.status).toBe("failed");
  expect(decoded.steps.find((step) => step.name === "harness-doc-filled")?.status).toBe("skipped");
});
