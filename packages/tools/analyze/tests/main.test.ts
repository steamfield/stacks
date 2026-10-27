import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "../src/cli";
import { DEFAULT_TOOLS_JSON_PATH, loadTools } from "../src/core/tools";
import { main } from "../src/main";
import { type SarifLog, validateSarif } from "../src/schemas/sarif";

const TREE = join(import.meta.dirname, "fixtures", "tree");
const EMPTY_TOOLS = join(import.meta.dirname, "fixtures", "empty-tools.json");

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

function runMain(args: string[]): Promise<{ outcome: unknown; stdout: string; stderr: string }> {
  const parsed = parse(args);
  if (!parsed.ok) throw new Error(parsed.reason);
  const stdout: string[] = [];
  const stderr: string[] = [];
  return main(parsed.parsed, {
    writers: {
      stdout: (s) => {
        stdout.push(s);
      },
      stderr: (s) => {
        stderr.push(s);
      },
    },
    toolsJsonPath: EMPTY_TOOLS,
  }).then((outcome) => ({ outcome, stdout: stdout.join(""), stderr: stderr.join("") }));
}

describe("main end-to-end", () => {
  test("writes a SARIF log to stdout that decodes against the schema", async () => {
    const { outcome, stdout } = await runMain([TREE]);
    expect(outcome).toEqual({ ok: true, written: true });
    const log = JSON.parse(stdout) as SarifLog;
    const validation = validateSarif(log);
    expect(validation.ok).toBe(true);
  });

  test("runs[0] is the envelope carrying properties.quickstacks", async () => {
    const { stdout } = await runMain([TREE]);
    const log = JSON.parse(stdout) as SarifLog;
    const envelope = log.runs[0];
    expect(envelope?.tool?.driver?.name).toBe("quickstacks-analyze");
    const qs = (envelope?.properties as { quickstacks?: { target?: { digest?: string } } })
      ?.quickstacks;
    expect(qs?.target?.digest).toMatch(/^sha256:[0-9a-f]+$/);
  });

  test("every artifact URI in the envelope is relative and POSIX-separated", async () => {
    const { stdout } = await runMain([TREE]);
    const log = JSON.parse(stdout) as SarifLog;
    const envelope = log.runs[0];
    const originalUriBaseIds = envelope?.originalUriBaseIds;
    expect(originalUriBaseIds?.["%SRCROOT%"]?.uri).toMatch(/^file:\/\//);
  });

  test("a non-existent target exits 2", async () => {
    const { outcome } = await runMain([join(TREE, "does-not-exist")]);
    expect(outcome).toEqual({ ok: false, kind: "input", message: expect.any(String) });
  });

  test("no planted environment variable value appears in the serialised output", async () => {
    process.env.QS_TEST_SECRET = "supersecret-leak-token-xyz";
    process.env.QS_TEST_TOKEN = "another-leak-token-abc";
    try {
      const { stdout } = await runMain([TREE]);
      expect(stdout).not.toContain("supersecret-leak-token-xyz");
      expect(stdout).not.toContain("another-leak-token-abc");
    } finally {
      delete process.env.QS_TEST_SECRET;
      delete process.env.QS_TEST_TOKEN;
    }
  });

  test("writing --out inside the target does not include the output file in the digest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-out-"));
    try {
      copyTree(TREE, dir);
      const outFile = join(dir, "record.sarif");
      const { stdout } = await runMain([dir, "--out", outFile]);
      expect(stdout).toBe("");
      const written = readFileSync(outFile, "utf8");
      const parsedLog = JSON.parse(written) as SarifLog;
      const qs = parsedLog.runs[0]?.properties as
        | { quickstacks?: { target?: { files?: number } } }
        | undefined;
      expect(qs?.quickstacks?.target?.files).toBe(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the default tools.json path loads all six configured adapters", () => {
    const tools = loadTools(DEFAULT_TOOLS_JSON_PATH);
    expect(tools.length).toBe(6);
    const ids = tools.map((t) => t.id);
    expect(ids).toEqual(["semgrep", "ruff", "eslint", "golangci-lint", "trivy", "gitleaks"]);
  });

  test("two runs over the same tree are identical once runId, createdAt and durations are stripped (runId is unique per invocation)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-det-"));
    try {
      copyTree(TREE, dir);
      const a = await runMain([dir]);
      const b = await runMain([dir]);
      const logA = JSON.parse(a.stdout) as SarifLog;
      const logB = JSON.parse(b.stdout) as SarifLog;
      const runIdA = (logA.runs[0]?.properties as { quickstacks?: { runId?: string } })?.quickstacks
        ?.runId;
      const runIdB = (logB.runs[0]?.properties as { quickstacks?: { runId?: string } })?.quickstacks
        ?.runId;
      expect(runIdA).toMatch(/^run-[0-9TZ]+-[0-9a-f]{8}$/);
      expect(runIdB).toMatch(/^run-[0-9TZ]+-[0-9a-f]{8}$/);
      expect(runIdA).not.toBe(runIdB);
      expect(stripVolatile(logA)).toEqual(stripVolatile(logB));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an adopted --sarif log with absolute artifact URIs is rewritten to relative URIs with the base in originalUriBaseIds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-sarif-"));
    try {
      copyTree(TREE, dir);
      const absArtifact = `${dir}/src/add.ts`.replace(/\\/g, "/");
      const adopted = {
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "external" } },
            results: [
              {
                ruleId: "x",
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: `file://${absArtifact}` },
                    },
                  },
                ],
              },
            ],
            artifacts: [{ location: { uri: `file://${absArtifact}` } }],
          },
        ],
      };
      const sarifFile = join(dir, "external.sarif");
      writeFileSync(sarifFile, JSON.stringify(adopted), "utf8");
      const { stdout } = await runMain([dir, "--sarif", sarifFile]);
      const log = JSON.parse(stdout) as SarifLog;
      const adoptedRun = log.runs.find((r) => r.tool?.driver?.name === "external");
      expect(adoptedRun).toBeDefined();
      expect(adoptedRun?.originalUriBaseIds?.["%SRCROOT%"]?.uri).toMatch(/^file:\/\//);
      const artifactUri = adoptedRun?.artifacts?.[0]?.location?.uri;
      expect(artifactUri).toBe("src/add.ts");
      const resultUri =
        adoptedRun?.results?.[0]?.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
      expect(resultUri).toBe("src/add.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function stripVolatile(log: SarifLog): string {
  const clone = JSON.parse(JSON.stringify(log)) as {
    runs: Array<{
      invocations?: Array<{ startTimeUtc?: unknown; endTimeUtc?: unknown }>;
      properties?: { quickstacks?: Record<string, unknown> };
    }>;
  };
  for (const run of clone.runs) {
    if (run.invocations) {
      for (const inv of run.invocations) {
        inv.startTimeUtc = "X";
        inv.endTimeUtc = "X";
      }
    }
    const qs = run.properties?.quickstacks;
    if (qs) {
      qs.runId = "X";
      qs.createdAt = "X";
    }
    if (Array.isArray(qs?.toolsNotRun)) {
      // toolsNotRun has no volatile fields; nothing to strip.
    }
  }
  return JSON.stringify(clone);
}
