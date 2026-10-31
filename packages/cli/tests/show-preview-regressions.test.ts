import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { BriefPreview } from "../src/schemas/validate";
import { quiet, runCli, terminal, writeError } from "./helpers/cli";
import {
  bundledFragment as fragment,
  previewResult,
  shipped,
  showReport,
  bundledStack as stack,
} from "./helpers/show-preview";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test("a preview with errors keeps its brief and exit 2 when human stderr is closed", async () => {
  const home = space.dir();
  const registry = space.dir();
  stack(registry);
  fragment(registry, "bad-decision", "decisions: [Undecided]");
  const args = ["validate", "--brief", "sample", "--with", "bad-decision"];
  const expected = await runCli([...args, "--json"], { home, env: quiet, host: { registry } });
  expect(expected.status).toBe(2);
  const brief: unknown = JSON.parse(expected.stdout);
  const failed = await runCli(args, {
    home,
    env: quiet,
    host: { registry, ...terminal },
    stderr: async () => {
      throw writeError("EPIPE");
    },
  });
  expect(failed.status).toBe(2);
  expect(failed.stderr).toBe("");
  // Decode the kept result with its public schema before comparing the text audience.
  expect(failed.stdout).toBe(Schema.decodeUnknownSync(BriefPreview)(brief).brief);
});

test.each([
  ["show", "sample"],
  ["validate", "--brief", "sample"],
])("%s exits 3 with InvalidConfig on a broken config.json, as its help says", async (...args) => {
  const home = space.dir();
  const registry = space.dir();
  stack(registry);
  mkdirSync(join(home, "config", "stacks"), { recursive: true });
  writeFileSync(join(home, "config", "stacks", "config.json"), "{");
  const run = await runCli([...args, "--json"], { home, env: quiet, host: { registry } });
  expect(run.status).toBe(3);
  expect(run.stdout).toBe("");
  expect(JSON.parse(run.stderr)).toMatchObject({ error: { tag: "InvalidConfig" } });
});

test("text previews escape terminal controls in retained guidance while JSON preserves them", async () => {
  const home = space.dir();
  const registry = space.dir();
  stack(
    registry,
    "sample",
    "",
    "## Setup\n\nRetained \u001b[31mguidance\u001b[0m.\n\tKeep this tab.\n",
  );
  const args = ["validate", "--brief", "sample"];
  const report = previewResult(
    await runCli([...args, "--json"], { home, env: quiet, host: { registry } }),
  );
  expect(report.brief).toContain("\u001b[31mguidance\u001b[0m");
  for (const audience of [terminal, { stdoutIsTTY: false }]) {
    const result = await runCli(args, { home, env: quiet, host: { registry, ...audience } });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(report.brief.replaceAll("\u001b", "\\u001b"));
    expect(result.stdout).toContain("\tKeep this tab.");
    expect(result.stderr).not.toContain("\u001b");
    if (!audience.stdoutIsTTY) expect(result.stderr).toBe("");
  }
});

test("text preview failures explain their findings on stderr and keep stdout equal to the brief", async () => {
  const home = space.dir();
  const registry = space.dir();
  stack(registry);
  fragment(registry, "bad-decision", "decisions: [Undecided]");
  const args = ["validate", "--brief", "sample", "--with", "bad-decision"];
  const json = await runCli([...args, "--json"], { home, env: quiet, host: { registry } });
  expect(json.status).toBe(2);
  expect(json.stderr.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(json.stderr)).toMatchObject({ error: { tag: "ValidationFailed" } });
  const report = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(json.stdout));
  expect(report.findings.map(({ check, severity }) => [check, severity])).toEqual([
    ["verify-run-duplicate", "note"],
    ["decision-default", "error"],
    ["fragment-no-verify", "note"],
  ]);
  for (const audience of [terminal, { stdoutIsTTY: false }]) {
    const result = await runCli(args, { home, env: quiet, host: { registry, ...audience } });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe(report.brief);
    for (const finding of report.findings) {
      if (finding.severity === "note") {
        expect(result.stderr).not.toContain(finding.check);
        continue;
      }
      expect(result.stderr).toContain(finding.check);
      expect(result.stderr).toContain(finding.file);
      expect(result.stderr).toContain(finding.message);
    }
    expect(result.stderr).toContain("Next:");
    expect(result.stderr).toMatch(/Validation failed\.\n$/);
  }
});

test("show preserves literal .tmpl basenames at the root and in subdirectories", async () => {
  const home = space.dir();
  const registry = space.dir();
  const entry = stack(registry);
  shipped(entry, "files/.tmpl");
  shipped(entry, "files/docs/.tmpl");
  const result = await runCli(["show", "sample", "--json"], {
    home,
    env: quiet,
    host: { registry },
  });
  const report = await showReport(result);
  expect(report.files).toEqual([
    { source: "files/.tmpl", path: ".tmpl" },
    { source: "files/docs/.tmpl", path: "docs/.tmpl" },
  ]);
});
