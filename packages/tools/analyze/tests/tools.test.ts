import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runTools } from "../src/core/tools";
import { countResults, type SarifRun } from "../src/schemas/sarif";

const TREE = join(import.meta.dirname, "fixtures", "tree");
const BIN = join(import.meta.dirname, "fixtures", "bin", "fake-tool.mjs");

function adapter(id: string, mode: string, timeoutMs = 10000): Record<string, unknown> {
  return {
    id,
    languages: [],
    binary: BIN,
    versionArgv: ["--version"],
    sarifArgv: [`--mode=${mode}`],
    timeoutMs,
    verified: false,
  };
}

function writeToolsJson(entries: Array<Record<string, unknown>>): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "tools-test-"));
  const path = join(dir, "tools.json");
  writeFileSync(path, JSON.stringify(entries), "utf8");
  return { path, dir };
}

function resultsCount(runs: readonly SarifRun[]): number {
  return countResults({ version: "2.1.0", runs });
}

describe("tool ledger states", () => {
  test("a fake binary emitting valid SARIF records ran with its result count", async () => {
    const { path, dir } = writeToolsJson([adapter("valid", "valid")]);
    try {
      const { ledger, runs } = await runTools(TREE, [], path);
      expect(ledger[0]?.status).toBe("ran");
      expect(resultsCount(runs)).toBe(1);
      expect(runs.length).toBe(1);
      expect(runs[0]?.tool?.driver?.name).toBe("fake-tool");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fake binary that prints valid SARIF and exits 1 records ran with findings counted", async () => {
    const { path, dir } = writeToolsJson([adapter("findings", "findings")]);
    try {
      const { ledger, runs } = await runTools(TREE, [], path);
      expect(ledger[0]?.status).toBe("ran");
      expect(resultsCount(runs)).toBe(1);
      expect(runs.length).toBe(1);
      expect(runs[0]?.tool?.driver?.name).toBe("fake-tool");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fake binary exiting 2 with no stdout records failed and contributes no runs", async () => {
    const { path, dir } = writeToolsJson([adapter("fail", "fail")]);
    try {
      const { ledger, runs } = await runTools(TREE, [], path);
      expect(ledger[0]?.status).toBe("failed");
      expect(ledger[0]?.reason).toContain("exit-code:2");
      expect(runs.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fake binary exiting 0 with invalid JSON records failed with invalid-sarif", async () => {
    const { path, dir } = writeToolsJson([adapter("badjson", "malformed")]);
    try {
      const { ledger, runs } = await runTools(TREE, [], path);
      expect(ledger[0]?.status).toBe("failed");
      expect(ledger[0]?.reason).toContain("invalid-sarif");
      expect(runs.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing binary records absent", async () => {
    const { path, dir } = writeToolsJson([
      {
        id: "missing",
        languages: [],
        binary: "nonexistent-binary-xyz-12345",
        versionArgv: [],
        sarifArgv: [],
        timeoutMs: 10000,
        verified: false,
      },
    ]);
    try {
      const { ledger, runs } = await runTools(TREE, [], path);
      expect(ledger[0]?.status).toBe("absent");
      expect(runs.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fake binary sleeping past its timeout records timeout and the run still succeeds", async () => {
    const { path, dir } = writeToolsJson([adapter("slow", "slow", 500)]);
    try {
      const { ledger, runs } = await runTools(TREE, [], path);
      expect(ledger[0]?.status).toBe("timeout");
      expect(runs.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a malformed SARIF payload is rejected with invalid-sarif while other runs survive", async () => {
    const { path, dir } = writeToolsJson([
      adapter("malformed", "malformed"),
      adapter("valid", "valid"),
    ]);
    try {
      const { ledger, runs } = await runTools(TREE, [], path);
      const malformed = ledger.find((e) => e.id === "malformed");
      const valid = ledger.find((e) => e.id === "valid");
      expect(malformed?.status).toBe("failed");
      expect(malformed?.reason).toContain("invalid-sarif");
      expect(valid?.status).toBe("ran");
      expect(runs.length).toBe(1);
      expect(runs[0]?.tool?.driver?.name).toBe("fake-tool");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a SARIF log with the wrong version is rejected naming the version", async () => {
    const { path, dir } = writeToolsJson([adapter("wrongversion", "invalid-version")]);
    try {
      const { ledger } = await runTools(TREE, [], path);
      expect(ledger[0]?.status).toBe("failed");
      expect(ledger[0]?.reason).toContain("invalid-sarif");
      expect(ledger[0]?.reason).toContain("2.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--tool selection marks non-selected adapters as skipped with reason not-selected", async () => {
    const { path, dir } = writeToolsJson([
      {
        id: "alpha",
        languages: [],
        binary: "nonexistent-alpha-12345",
        versionArgv: [],
        sarifArgv: [],
        timeoutMs: 10000,
        verified: false,
      },
      {
        id: "beta",
        languages: [],
        binary: "nonexistent-beta-67890",
        versionArgv: [],
        sarifArgv: [],
        timeoutMs: 10000,
        verified: false,
      },
      {
        id: "gamma",
        languages: [],
        binary: "nonexistent-gamma-00000",
        versionArgv: [],
        sarifArgv: [],
        timeoutMs: 10000,
        verified: false,
      },
    ]);
    try {
      const { ledger } = await runTools(TREE, ["beta"], path);
      const alpha = ledger.find((e) => e.id === "alpha");
      const beta = ledger.find((e) => e.id === "beta");
      const gamma = ledger.find((e) => e.id === "gamma");
      expect(alpha?.status).toBe("skipped");
      expect(alpha?.reason).toBe("not-selected");
      expect(gamma?.status).toBe("skipped");
      expect(gamma?.reason).toBe("not-selected");
      expect(beta?.status).toBe("absent");
      expect(ledger.length).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("without --tool every adapter is probed and none is skipped", async () => {
    const { path, dir } = writeToolsJson([
      {
        id: "alpha",
        languages: [],
        binary: "nonexistent-alpha-12345",
        versionArgv: [],
        sarifArgv: [],
        timeoutMs: 10000,
        verified: false,
      },
      {
        id: "beta",
        languages: [],
        binary: "nonexistent-beta-67890",
        versionArgv: [],
        sarifArgv: [],
        timeoutMs: 10000,
        verified: false,
      },
    ]);
    try {
      const { ledger } = await runTools(TREE, [], path);
      expect(ledger.length).toBe(2);
      for (const entry of ledger) {
        expect(entry.status).not.toBe("skipped");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
